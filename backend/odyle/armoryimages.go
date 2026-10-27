package odyle

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/image/draw"
)

// The armory's images (#67): the game icons the kept profiles name (items, manastones,
// skills, skins, wings, pet and Daevanion boards) and each character's official portrait.
// The armory queue downloads them from PLAYNC while it looks a profile up, and the dashboard
// loads them from the Odyle server only, so browsers never contact NCSOFT and the content
// security policy keeps allowing images from Odyle alone. They are files in
// pb_data/armory_images: an icon under PLAYNC's file name (Icon_WP_MA_0078_T05.png), shrunk
// from PLAYNC's 256 or 512 pixels to iconSize, the most the page shows on a sharp screen; a
// portrait under the SHA-256 of its bytes (portrait-<32 hex>.png), so a name always shows
// the same image. The nightly armory clean-up deletes the files no kept profile names.

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

func imageDir(app core.App) string { return filepath.Join(app.DataDir(), "armory_images") }

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
	dir := imageDir(app)
	kept := map[string]bool{}
	defer p.eachIcon(func(name *string) {
		if !kept[*name] {
			*name = ""
		}
	})
	if err := os.MkdirAll(dir, 0o755); err != nil {
		warn(app, "Odyle could not keep armory images", "error", message(err))
		return
	}
	missing := []string{}
	for _, name := range p.icons() {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			kept[name] = true
		} else if len(missing) < iconsPerLookup {
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
		download(func() { p.Portrait = keepPortrait(dir, p.portraitLink) })
	}
	for _, name := range missing {
		download(func() {
			if keepIcon(app, dir, name) {
				mu.Lock()
				kept[name] = true
				mu.Unlock()
			}
		})
	}
	wg.Wait()
}

// keepIcon downloads a game icon, shrinks it and keeps it; false when PLAYNC does not have it.
func keepIcon(app core.App, dir, name string) bool {
	res, err := send(call{method: "GET", url: assetsURL() + name, headers: map[string]string{"user-agent": userAgent}, timeout: 15 * time.Second, limit: iconLimit})
	if err != nil || res.status != 200 || !bytes.HasPrefix(res.body, pngSignature) {
		return false
	}
	icon, err := shrinkIcon(res.body)
	if err == nil {
		err = writeImage(dir, name, icon)
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
func keepPortrait(dir, link string) string {
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
	if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
		return name
	}
	if writeImage(dir, name, res.body) != nil {
		return ""
	}
	return name
}

// writeImage keeps an image under its name, written whole or not at all.
func writeImage(dir, name string, image []byte) error {
	file, err := os.CreateTemp(dir, ".download-*")
	if err != nil {
		return err
	}
	_, err = file.Write(image)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(file.Name(), filepath.Join(dir, name))
	}
	if err != nil {
		_ = os.Remove(file.Name())
	}
	return err
}

var imageTypesByExtension = map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}

// armoryImageRoute answers GET /api/odyle/armory-images/{file}: an image the armory keeps.
// A name always shows the same image, so browsers keep it for a year. Public, under the
// general rate limit of /api/odyle/ (a profile names some hundred images).
func armoryImageRoute(e *core.RequestEvent) error {
	name := e.Request.PathValue("file")
	if !imageNames.MatchString(name) {
		return notFound("This image is not kept.")
	}
	file, err := os.Open(filepath.Join(imageDir(e.App), name))
	if err != nil {
		return notFound("This image is not kept.")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	headers := e.Response.Header()
	headers.Set("Content-Type", imageTypesByExtension[filepath.Ext(name)])
	headers.Set("Cache-Control", "public, max-age=31536000, immutable")
	headers.Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(e.Response, e.Request, name, info.ModTime(), file)
	return nil
}

// cleanArmoryImages deletes the kept images that no kept profile names, once they are an hour
// old: a lookup downloads its images before it keeps the profile that names them.
func cleanArmoryImages(app core.App) (int, error) {
	entries, err := os.ReadDir(imageDir(app))
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
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
	deleted := 0
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || entry.IsDir() || named[entry.Name()] || time.Since(info.ModTime()) < imageGrace {
			continue
		}
		if err := os.Remove(filepath.Join(imageDir(app), entry.Name())); err == nil {
			deleted++
		}
	}
	return deleted, nil
}

// armoryImages counts the kept images and their bytes, for the Server status page.
func armoryImages(app core.App) (count int, size int64) {
	entries, _ := os.ReadDir(imageDir(app))
	for _, entry := range entries {
		if info, err := entry.Info(); err == nil && !entry.IsDir() {
			count++
			size += info.Size()
		}
	}
	return count, size
}
