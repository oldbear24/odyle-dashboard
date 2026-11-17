package odyle

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem/blob"
	"golang.org/x/image/draw"
)

// The armory's images (#67): the game icons the kept profiles name (items, manastones,
// skills, skins, wings, pet and Daevanion boards) and each character's official portrait.
// The armory queue downloads them from PLAYNC while it looks a profile up, and the dashboard
// loads them from the Odyle server only, so browsers never contact NCSOFT and the content
// security policy keeps allowing images from Odyle alone. They are records of armory_images
// (imagestore.go), with their files in PocketBase's file storage: an icon under PLAYNC's file
// name (Icon_WP_MA_0078_T05.png), shrunk from PLAYNC's 256 or 512 pixels to iconSize, the most
// the page shows on a sharp screen; a portrait under the SHA-256 of its bytes
// (portrait-<32 hex>.png), so a name always shows the same image. The nightly armory clean-up
// deletes the images no kept profile names.

const armoryIconBase = "https://assets.playnccdn.com/static-aion2-gamedata/resources/"

func assetsURL() string {
	if v := os.Getenv("PLAYNC_ASSETS_URL"); v != "" {
		return v
	}
	return armoryIconBase
}

var (
	iconNames  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}\.png$`)
	imageNames = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}\.(?:png|jpg|webp)$`)
	// The image names in a kept profile's JSON, for the clean-up.
	imageMentions = regexp.MustCompile(`"(?:icon|portrait)":"([A-Za-z0-9_.-]+)"`)
	pngSignature  = []byte("\x89PNG\r\n\x1a\n")
)

const (
	iconLimit      = 2 << 20   // the largest icon downloaded
	iconPixels     = 2048      // the widest and highest icon decoded
	iconSize       = 112       // the width and height icons are kept at, at most
	iconsPerLookup = 300       // the most icons one lookup downloads at once (it does twice)
	imageGrace     = time.Hour // an image no profile names yet is kept at least this long
)

// armoryImageLanes is how many images a lookup downloads side by side from PLAYNC's CDN.
const armoryImageLanes = 6

// iconOf is the file name of the game icon that m[key] links to, or "" for any other link.
func iconOf(m map[string]any, key string) string {
	link, _ := m[key].(string)
	name, ok := strings.CutPrefix(link, armoryIconBase)
	if !ok || !iconNames.MatchString(name) {
		return ""
	}
	return name
}

// armoryImagesDir is the folder of pb_data the images were kept in before 0.61.0, and their
// prefix in the S3 storage; importLegacyImages turns what is left there into records
// (imagestore.go). Backups leave it out, and a restore keeps the one the server has.
const armoryImagesDir = "armory_images"

func imageDir(app core.App) string { return filepath.Join(app.DataDir(), armoryImagesDir) }

// eachIcon calls visit with every icon name the profile holds.
func (p *armoryProfile) eachIcon(visit func(name *string)) {
	for i := range p.Gear {
		g := &p.Gear[i]
		visit(&g.Icon)
		if d := g.Detail; d != nil {
			for j := range d.Stones {
				visit(&d.Stones[j].Icon)
			}
			for j := range d.GodStones {
				visit(&d.GodStones[j].Icon)
			}
			for j := range d.SubSkills {
				visit(&d.SubSkills[j].Icon)
			}
		}
	}
	for i := range p.Skins {
		visit(&p.Skins[i].Icon)
	}
	for i := range p.Skills {
		visit(&p.Skills[i].Icon)
	}
	for i := range p.Boards {
		visit(&p.Boards[i].Icon)
	}
}

// icons are the game icons the profile names, each once.
func (p *armoryProfile) icons() []string {
	seen, out := map[string]bool{}, []string{}
	p.eachIcon(func(name *string) {
		if *name != "" && !seen[*name] {
			seen[*name] = true
			out = append(out, *name)
		}
	})
	return out
}

// keepArmoryImages downloads the icons the profile names that the server does not keep yet,
// armoryImageLanes side by side, and with portrait the character's portrait too. An image
// that cannot be downloaded (PLAYNC lacks a few) is left out of the profile: the page shows
// the character's initials or an empty frame, and the next lookup tries again.
func keepArmoryImages(app core.App, p *armoryProfile, track *armoryTrack, portrait bool) {
	kept, err := keptImages(app, p.icons())
	if err != nil {
		warn(app, "Odyle could not read which armory images it keeps", "error", message(err))
		kept = map[string]bool{}
	}
	defer p.eachIcon(func(name *string) {
		if !kept[*name] {
			*name = ""
		}
	})
	missing := []string{}
	for _, name := range p.icons() {
		if !kept[name] && len(missing) < iconsPerLookup {
			missing = append(missing, name)
		}
	}
	images := len(missing)
	if portrait = portrait && p.portraitLink != ""; portrait {
		images++
	}
	track.begin("images", images, imageWorth)
	var mu sync.Mutex
	var wg sync.WaitGroup
	lanes := make(chan struct{}, armoryImageLanes)
	download := func(fetch func()) {
		wg.Add(1)
		lanes <- struct{}{}
		go func() {
			defer func() { <-lanes; track.tick(); wg.Done() }()
			fetch()
		}()
	}
	if portrait {
		download(func() { p.Portrait = keepPortrait(app, p.portraitLink) })
	}
	for _, name := range missing {
		download(func() {
			if keepIcon(app, name) {
				mu.Lock()
				kept[name] = true
				mu.Unlock()
			}
		})
	}
	wg.Wait()
}

// keepIcon downloads a game icon, shrinks it and keeps it; false when PLAYNC does not have it.
func keepIcon(app core.App, name string) bool {
	res, err := send(call{method: "GET", url: assetsURL() + name, headers: map[string]string{"user-agent": userAgent}, timeout: 15 * time.Second, limit: iconLimit})
	if err != nil || res.status != 200 || !bytes.HasPrefix(res.body, pngSignature) {
		return false
	}
	icon, err := shrinkIcon(res.body)
	if err == nil {
		err = saveImage(app, name, icon)
	}
	if err != nil {
		warn(app, "Odyle could not keep an armory image", "error", message(err))
		return false
	}
	return true
}

// shrinkIcon fits a PNG icon into iconSize pixels, or returns it as it is when it fits.
func shrinkIcon(icon []byte) ([]byte, error) {
	config, err := png.DecodeConfig(bytes.NewReader(icon))
	if err != nil {
		return nil, err
	}
	if config.Width <= iconSize && config.Height <= iconSize {
		return icon, nil
	}
	if config.Width > iconPixels || config.Height > iconPixels {
		return nil, fmt.Errorf("the icon is %d by %d pixels", config.Width, config.Height)
	}
	src, err := png.Decode(bytes.NewReader(icon))
	if err != nil {
		return nil, err
	}
	width, height := iconSize, iconSize
	if config.Width > config.Height {
		height = max(1, config.Height*iconSize/config.Width)
	} else if config.Height > config.Width {
		width = max(1, config.Width*iconSize/config.Height)
	}
	small := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(small, small.Bounds(), src, src.Bounds(), draw.Src, nil)
	var out bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, small); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// keepPortrait downloads the official portrait the profile links (only ever from the
// portrait host, as portraits.go does) and returns its file name, or "".
func keepPortrait(app core.App, link string) string {
	u, err := url.Parse(link)
	if err != nil || !strings.HasPrefix(u.Path, "/") {
		return ""
	}
	res, err := send(call{method: "GET", url: imageBase() + u.RequestURI(), headers: map[string]string{"user-agent": userAgent}, timeout: 15 * time.Second, limit: portraitLimit, redirects: []string{"*.plaync.com", "*.playnccdn.com"}})
	if err != nil || res.status != 200 {
		return ""
	}
	ext, ok := imageTypes[strings.TrimSpace(strings.Split(res.header.Get("Content-Type"), ";")[0])]
	if !ok || !strings.HasPrefix(http.DetectContentType(res.body), "image/") {
		return ""
	}
	name := "portrait-" + portraitHash(res.body)[:32] + "." + ext
	if imageKept(app, name) {
		return name
	}
	if err := saveImage(app, name, res.body); err != nil {
		warn(app, "Odyle could not keep an armory image", "error", message(err))
		return ""
	}
	return name
}

var imageTypesByExtension = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}

// armoryImageRoute answers GET /api/odyle/armory-images/{file}: an image the armory keeps, the
// file of its armory_images record (imagestore.go). A name always shows the same image, so
// browsers keep it for a year, and one asking whether it changed is told it did not without the
// file storage being asked; a name the server does not keep answers 404 without asking it either,
// and without caching. A record whose file the storage no longer holds (after a restore, or a
// change of the file storage) goes, so the profile that names it fetches it again when opened.
// Public, under the general rate limit of /api/odyle/ (a profile names some hundred images).
func armoryImageRoute(e *core.RequestEvent) error {
	name := e.Request.PathValue("file")
	if !imageNames.MatchString(name) {
		return notFound("This image is not kept.")
	}
	record, err := e.App.FindFirstRecordByData(armoryImagesCollection, "name", name)
	if err != nil && !isNoRows(err) {
		return err
	}
	if record == nil {
		// Kept before 0.61.0 and not imported yet: served from where it was.
		if stateOf(e.App).importing.Load() {
			if file, at, err := legacyImage(e.App, name); err == nil {
				defer file.Close()
				serveImage(e, name, at, file)
				return nil
			}
		}
		return notFound("This image is not kept.")
	}
	at := record.GetDateTime("created").Time()
	if notModified(e.Request, `"`+name+`"`, at) {
		imageHeaders(e, name)
		e.Response.WriteHeader(http.StatusNotModified)
		return nil
	}
	file, err := imageFile(e.App, record)
	if err != nil {
		if s := stateOf(e.App); (errors.Is(err, blob.ErrNotFound) || errors.Is(err, fs.ErrNotExist)) && !s.moving.Load() && !s.importing.Load() {
			if err := e.App.Delete(record); err != nil {
				warn(e.App, "Odyle could not forget an armory image its storage lost", "image", name, "error", message(err))
			}
		} else {
			warn(e.App, "Odyle could not read an armory image", "image", name, "error", message(err))
		}
		return notFound("This image is not kept.")
	}
	defer file.Close()
	serveImage(e, name, at, file)
	return nil
}

// imageHeaders are an image's headers: its type by its extension, a year of caching and the name
// as its ETag.
func imageHeaders(e *core.RequestEvent, name string) {
	headers := e.Response.Header()
	headers.Set("Content-Type", imageTypesByExtension[filepath.Ext(name)])
	headers.Set("Cache-Control", imageCacheControl)
	headers.Set("ETag", `"`+name+`"`)
	headers.Set("X-Content-Type-Options", "nosniff")
}

// serveImage answers with an image (ranges and conditions as net/http serves them).
func serveImage(e *core.RequestEvent, name string, at time.Time, file io.ReadSeeker) {
	imageHeaders(e, name)
	http.ServeContent(e.Response, e.Request, name, at, file)
}

// notModified reports whether a request asks whether an image stored at that time changed: by its
// ETag, or by a time not before it. An image never changes under its name.
func notModified(r *http.Request, tag string, at time.Time) bool {
	match := r.Header.Get("If-None-Match")
	since, err := http.ParseTime(r.Header.Get("If-Modified-Since"))
	return match == "*" || strings.Contains(match, tag) || match == "" && err == nil && !at.Truncate(time.Second).After(since)
}

// cleanArmoryImages deletes the kept images that no kept profile names, once they are an hour
// old: a lookup keeps its images before it keeps the profile that names them. Deleting a record
// deletes its file.
func cleanArmoryImages(app core.App) (int, error) {
	named := map[string]bool{}
	rows, err := app.DB().NewQuery("SELECT COALESCE(CAST(profile AS TEXT), '') FROM armory_profiles").Rows()
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var profile string
		if err := rows.Scan(&profile); err != nil {
			rows.Close()
			return 0, err
		}
		for _, m := range imageMentions.FindAllStringSubmatch(profile, -1) {
			named[m[1]] = true
		}
	}
	if err := rows.Close(); err != nil {
		return 0, err
	}
	// The classes' emblems (classes.go).
	for _, c := range gameClasses(app) {
		named[c.Icon] = true
	}
	stored := []struct {
		Id   string `db:"id"`
		Name string `db:"name"`
	}{}
	if err := app.DB().Select("id", "name").From(armoryImagesCollection).Where(dbx.NewExp("created < {:grace}", dbx.Params{"grace": ago(imageGrace)})).All(&stored); err != nil {
		return 0, err
	}
	deleted := 0
	for _, s := range stored {
		if named[s.Name] {
			continue
		}
		record, err := app.FindRecordById(armoryImagesCollection, s.Id)
		if err != nil {
			continue
		}
		if err := app.Delete(record); err == nil {
			deleted++
		}
	}
	return deleted, nil
}

// imagesMissing reports whether a kept profile (its JSON) names an image the server does not
// keep: after a restore, or a change of the file storage. Not while the images kept before 0.61.0
// are being imported (imagestore.go), nor when it cannot tell.
func imagesMissing(app core.App, profile string) bool {
	if stateOf(app).importing.Load() {
		return false
	}
	names := []string{}
	for _, m := range imageMentions.FindAllStringSubmatch(profile, -1) {
		names = append(names, m[1])
	}
	kept, err := keptImages(app, names)
	if err != nil {
		return false
	}
	for _, name := range names {
		if !kept[name] {
			return true
		}
	}
	return false
}
