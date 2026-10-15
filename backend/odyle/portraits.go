package odyle

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// Official AION 2 Global character portraits. PLAYNC's public character search
// returns a profileImageUrl for each character; the backend downloads that image
// into the character's portrait field, so browsers never contact NCSOFT.
//
// Server ids follow the game protocol (see odyle-windows GameIdentity.cs):
// race * 1000 + region * 100 + list index + 1. Saved characters keep only the
// server name and region, so the id is rebuilt here. NA has two search regions
// (East 1xx, West 2xx) and both are tried.
var elyos = strings.Split("Siel,Nezekan,Vaizel,Kaisinel,Yustiel,Ariel,Fregion,Meslamtaeda,Hithanya,Nania,Tahabata,Luteros,Phernos,Daminu,Kasika,Bakarma,Tsenka,Kochi,Ishtar,Tiamat,Poeta,Verteron,Nathara,Talisra,Zumion,Nahid,Asahr,Caelid,Laveis,Perion,Dramata,Reda,Auldor,Vakron,Narun,Gartua,Chloris,Ione,Teina,Dymones,Bargott,Atheron,Ruthilis,Siliator,Idris,Satia,Estian,Rahu,Rhanman,Hebran", ",")
var asmodian = strings.Split("Israphel,Zikel,Triniel,Lumiel,Marchutan,Azphel,Ereshkigal,Beritra,Nemon,Hadala,Ludra,Ulgorn,Munin,Odar,Zemurru,Kromede,Quai,Baba,Fafnir,Indnath,Ishalgen,Altgard,Agnita,Atiel,Valdemar,Lagta,Gerod,Urd,Ecco,Giselle,Kashapa,Stof,Berk,Nuakum,Grisilla,Santras,Reuben,Hugo,Kraki,Hystan,Rathman,Sigebert,Nazmun,Gelcos,Paton,Pelleir,Elvida,Ketu,Pydeon,Notun", ",")

type searchRegion struct {
	digit int
	code  string
}

var searchRegions = map[string][]searchRegion{"GLOBAL_NA": {{1, "nae"}, {2, "naw"}}, "GLOBAL_EU": {{3, "eu"}}, "GLOBAL_SA": {{4, "la"}}, "GLOBAL_ASIA": {{5, "as"}}}

func searchURL() string {
	if v := os.Getenv("PLAYNC_SEARCH_URL"); v != "" {
		return v
	}
	return "https://api-search.plaync.com/aion2global/search/v2/character"
}

func imageBase() string {
	if v := os.Getenv("PLAYNC_IMAGE_URL"); v != "" {
		return v
	}
	return "https://profileimg.plaync.com"
}

var imageTypes = map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

// portraitLimit is the largest portrait the characters' portrait field takes.
const portraitLimit = 512 << 10

type search struct {
	serverId int
	region   string
}

func index(names []string, name string) int {
	for i, n := range names {
		if n == name {
			return i
		}
	}
	return -1
}

func searches(server, region string) []search {
	elyosIndex, asmodianIndex := index(elyos, server), index(asmodian, server)
	race := 0
	if elyosIndex >= 0 {
		race = 1
	} else if asmodianIndex >= 0 {
		race = 2
	}
	if race == 0 {
		return nil
	}
	at := max(elyosIndex, asmodianIndex) + 1
	out := []search{}
	for _, r := range searchRegions[region] {
		out = append(out, search{serverId: race*1000 + r.digit*100 + at, region: r.code})
	}
	return out
}

var tags = regexp.MustCompile(`<[^>]*>`)

func plainName(name any) string {
	s, _ := name.(string)
	return strings.ToLower(trim(tags.ReplaceAllString(s, "")))
}

func number(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		f, err := strconv.ParseFloat(trim(x), 64)
		if err != nil {
			return -1
		}
		return f
	}
	return -1
}

func imageURL(name, server, region string) (string, error) {
	for _, s := range searches(server, region) {
		// encodeURIComponent: spaces as %20.
		query := "keyword=" + strings.ReplaceAll(url.QueryEscape(name), "+", "%20") + "&serverId=" + strconv.Itoa(s.serverId) + "&region=" + s.region + "&localeInfo=en-US&page=1&size=20"
		res, err := send(call{method: "GET", url: searchURL() + "?" + query, headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 10 * time.Second, limit: 1 << 20})
		if err != nil {
			return "", err
		}
		if res.status != 200 {
			return "", errors.New("The official character search is unavailable (" + strconv.Itoa(res.status) + ").")
		}
		found, _ := res.json().(map[string]any)
		hits, _ := found["list"].([]any)
		for _, raw := range hits {
			hit, _ := raw.(map[string]any)
			if plainName(hit["name"]) != plainName(name) || number(hit["serverId"]) != float64(s.serverId) {
				continue
			}
			// Only ever fetch from the portrait host: the search result supplies a path.
			if path, ok := hit["profileImageUrl"].(string); ok && strings.HasPrefix(path, "/") {
				return imageBase() + path, nil
			}
			break
		}
	}
	return "", nil
}

type portrait struct {
	file *filesystem.File
	hash string
}

// fetchPortrait loads the character's official portrait, or nil when the search does
// not list it (new, renamed or deleted characters, unknown servers).
func fetchPortrait(name, server, region string) (*portrait, error) {
	link, err := imageURL(name, server, region)
	if err != nil || link == "" {
		return nil, err
	}
	// The portrait host redirects to PLAYNC's download CDN (fizz-download.playnccdn.com).
	// An image larger than the portrait field takes (512 KB) is refused while it is read.
	res, err := send(call{method: "GET", url: link, headers: map[string]string{"user-agent": userAgent}, timeout: 15 * time.Second, limit: portraitLimit, redirects: []string{"*.plaync.com", "*.playnccdn.com"}})
	if err != nil {
		return nil, err
	}
	kind := strings.TrimSpace(strings.Split(res.header.Get("Content-Type"), ";")[0])
	ext, ok := imageTypes[kind]
	if res.status != 200 || !ok {
		return nil, errors.New("The official portrait could not be downloaded.")
	}
	file, err := filesystem.NewFileFromBytes(res.body, "portrait."+ext)
	if err != nil {
		return nil, err
	}
	return &portrait{file: file, hash: portraitHash(res.body)}, nil
}

// portraitHash identifies an image by the SHA-256 of its bytes, as saved in portraitHash.
func portraitHash(image []byte) string {
	sum := sha256.Sum256(image)
	return hex.EncodeToString(sum[:])
}

// portraitWork keeps the PLAYNC lookups apart: at most two run at a time, whether the
// job or a newly saved character started them, and never two for one character.
type portraitWork struct {
	mu      sync.Mutex
	idle    *sync.Cond // signalled when a lookup ends
	running map[string]bool
	slots   chan struct{}
}

func newPortraitWork() *portraitWork {
	w := &portraitWork{running: map[string]bool{}, slots: make(chan struct{}, 2)}
	w.idle = sync.NewCond(&w.mu)
	return w
}

// claim reserves the character's lookup; false when one runs already.
func (w *portraitWork) claim(id string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.running[id] {
		return false
	}
	w.running[id] = true
	return true
}

// lookUp runs the claimed lookup of a character in one of the slots.
func (w *portraitWork) lookUp(app core.App, id string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("the portrait lookup failed: %v", r)
		}
		w.mu.Lock()
		delete(w.running, id)
		w.mu.Unlock()
		w.idle.Broadcast()
	}()
	w.slots <- struct{}{}
	defer func() { <-w.slots }()
	return gamePortrait(app, id)
}

// wait returns once no lookup runs (the test build's job route waits for it).
func (w *portraitWork) wait() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for len(w.running) > 0 {
		w.idle.Wait()
	}
}

// watchCharacters gives a newly saved character its portrait right away, instead of
// at the job's next run, unless superusers paused portraits.
func watchCharacters(app core.App) {
	app.OnRecordAfterCreateSuccess("characters").BindFunc(func(e *core.RecordEvent) error {
		if work := stateOf(e.App).portraits; !readSettings(e.App).PortraitsPaused && work.claim(e.Record.Id) {
			go func(app core.App, id string) {
				if err := work.lookUp(app, id); err != nil {
					warn(app, "Odyle portrait lookup failed", "character", id, "error", message(err))
				}
			}(e.App, e.Record.Id)
		}
		return e.Next()
	})
}

// gamePortrait loads the official portrait into the character; the file is only
// rewritten when the image changed. Download errors are returned after the attempt is
// recorded. Never call it inside a transaction: it waits on PLAYNC. Portraits come only
// from the game; no route lets players set or replace them.
func gamePortrait(app core.App, id string) error {
	before, err := app.FindRecordById("characters", id)
	if err != nil {
		return err
	}
	found, failure := fetchPortrait(before.GetString("characterName"), before.GetString("server"), before.GetString("region"))
	// Saved from a fresh copy in one transaction: a reading saved while PLAYNC answered,
	// or saved meanwhile by another request, is kept.
	var changed bool
	var owner string
	if err := app.RunInTransaction(func(tx core.App) error {
		c, err := tx.FindRecordById("characters", id)
		if err != nil {
			return err
		}
		changed, owner = found != nil && (found.hash != c.GetString("portraitHash") || c.GetString("portrait") == ""), c.GetString("user")
		if changed {
			c.Set("portrait", found.file)
			c.Set("portraitHash", found.hash)
		}
		c.Set("portraitCheckedAt", now())
		return tx.Save(c)
	}); err != nil {
		return err
	}
	if changed {
		roomIds, err := roomsFor(app, owner)
		if err != nil {
			return err
		}
		notify(app, roomIds)
	}
	return failure
}

// refreshPortraits is a job: characters saved while portraits were paused (or whose
// lookup failed) get theirs within a minute, missing ones are retried hourly and the
// rest refresh daily. Five characters per run, two at a time, keep traffic to PLAYNC
// low; a character whose lookup runs already is left to it. Superusers can pause it
// (Server controls).
func refreshPortraits(app core.App) (result, error) {
	if readSettings(app).PortraitsPaused {
		return result{"skipped": "paused"}, nil
	}
	due, err := app.FindRecordsByFilter("characters", "portraitCheckedAt = '' || (portrait = '' && portraitCheckedAt < {:hour}) || portraitCheckedAt < {:day}", "portraitCheckedAt", 5, 0, dbx.Params{"hour": ago(time.Hour), "day": ago(24 * time.Hour)})
	if err != nil {
		return nil, err
	}
	work := stateOf(app).portraits
	var mu sync.Mutex
	var wg sync.WaitGroup
	out := result{"done": 0, "failed": 0}
	for _, c := range due {
		if !work.claim(c.Id) {
			continue
		}
		wg.Go(func() {
			err := work.lookUp(app, c.Id)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				out["failed"] = out["failed"].(int) + 1
				out["error"] = "Character " + c.Id + ": " + message(err)
				warn(app, "Odyle portrait refresh failed", "character", c.Id, "error", message(err))
				return
			}
			out["done"] = out["done"].(int) + 1
		})
	}
	wg.Wait()
	return out, nil
}
