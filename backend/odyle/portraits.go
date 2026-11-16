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

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
)

// Official AION 2 Global character portraits. PLAYNC's public character search
// returns a profileImageUrl for each character; the backend downloads that image
// into the character's portrait field, so browsers never contact NCSOFT.
//
// Server ids follow the game protocol (see odyle-windows GameIdentity.cs):
// race * 1000 + region * 100 + list index + 1, with the names in servers.go. Saved characters
// keep only the server name and region, so the id is rebuilt here. NA has two search regions
// (East 1xx, West 2xx): GLOBAL_NAW is West, and GLOBAL_NA tries East, then West, since NA
// characters saved before the split may be either.

type searchRegion struct {
	digit int
	code  string
}

var searchRegions = map[string][]searchRegion{"GLOBAL_NA": {{1, "nae"}, {2, "naw"}}, "GLOBAL_NAW": {{2, "naw"}}, "GLOBAL_EU": {{3, "eu"}}, "GLOBAL_SA": {{4, "la"}}, "GLOBAL_ASIA": {{5, "as"}}}

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

// The search lists names that contain the keyword, 20 to a page, so a short name can
// come after longer ones: a lookup reads up to five pages, until the name or the last
// page (by pagination.total; without it the first page is the last).
const searchPageSize, searchPages = 20, 5

// officialHit is what the search lists for the character: its portrait link ("" without one),
// and its official id with the search region and server id that find its armory profile, its
// level and class id (pcId), all from PLAYNC (#25). id is "" when the search does not list it.
type officialHit struct {
	link, id, region string
	serverId         int
	level, classId   int64
}

// findOfficial is the character as the search lists it. A failed search returns its error only
// when no other search region listed the character.
func findOfficial(book serverBook, name, server, region string) (officialHit, error) {
	var failure error
	for _, s := range book.searches(server, region) {
		hit, err := searchServer(name, s)
		if hit.id != "" {
			return hit, nil
		}
		if err != nil && failure == nil {
			failure = err
		}
	}
	return officialHit{}, failure
}

func searchServer(name string, s search) (officialHit, error) {
	for page := 1; page <= searchPages; page++ {
		// encodeURIComponent: spaces as %20.
		query := "keyword=" + strings.ReplaceAll(url.QueryEscape(name), "+", "%20") + "&serverId=" + strconv.Itoa(s.serverId) + "&region=" + s.region + "&localeInfo=en-US&page=" + strconv.Itoa(page) + "&size=" + strconv.Itoa(searchPageSize)
		res, err := send(call{method: "GET", url: searchURL() + "?" + query, headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 10 * time.Second, limit: 1 << 20})
		if err != nil {
			return officialHit{}, err
		}
		if res.status != 200 {
			return officialHit{}, errors.New("The official character search is unavailable (" + strconv.Itoa(res.status) + ").")
		}
		found, _ := res.json().(map[string]any)
		hits, _ := found["list"].([]any)
		for _, raw := range hits {
			hit, _ := raw.(map[string]any)
			if plainName(hit["name"]) != plainName(name) || number(hit["serverId"]) != float64(s.serverId) {
				continue
			}
			found := officialHit{region: s.region, serverId: s.serverId, level: max(0, int64(number(hit["level"]))), classId: max(0, int64(number(hit["pcId"])))}
			// The search lists the id URL-encoded; ids that cannot be PLAYNC's are left out.
			if id, err := url.QueryUnescape(textOf(hit["characterId"])); err == nil && armoryIds.MatchString(id) {
				found.id = id
			} else {
				found.id = "-"
			}
			// Only ever fetch from the portrait host: the search result supplies a path.
			if path, ok := hit["profileImageUrl"].(string); ok && strings.HasPrefix(path, "/") {
				found.link = imageBase() + path
			}
			return found, nil
		}
		pagination, _ := found["pagination"].(map[string]any)
		if len(hits) < searchPageSize || float64(page*searchPageSize) >= number(pagination["total"]) {
			break
		}
	}
	return officialHit{}, nil
}

type portrait struct {
	file *filesystem.File
	hash string
}

// fetchPortrait loads the character's official portrait, or nil when the search does
// not list it (new, renamed or deleted characters, unknown servers), with what the search
// lists for it.
func fetchPortrait(book serverBook, name, server, region string) (*portrait, officialHit, error) {
	hit, err := findOfficial(book, name, server, region)
	if err != nil || hit.link == "" {
		return nil, hit, err
	}
	link := hit.link
	// The portrait host redirects to PLAYNC's download CDN (fizz-download.playnccdn.com).
	// An image larger than the portrait field takes (512 KB) is refused while it is read.
	res, err := send(call{method: "GET", url: link, headers: map[string]string{"user-agent": userAgent}, timeout: 15 * time.Second, limit: portraitLimit, redirects: []string{"*.plaync.com", "*.playnccdn.com"}})
	if err != nil {
		return nil, hit, err
	}
	kind := strings.TrimSpace(strings.Split(res.header.Get("Content-Type"), ";")[0])
	ext, ok := imageTypes[kind]
	if res.status != 200 || !ok {
		return nil, hit, errors.New("The official portrait could not be downloaded.")
	}
	file, err := filesystem.NewFileFromBytes(res.body, "portrait."+ext)
	if err != nil {
		return nil, hit, err
	}
	return &portrait{file: file, hash: portraitHash(res.body)}, hit, nil
}

// portraitHash identifies an image by the SHA-256 of its bytes, as saved in portraitHash.
func portraitHash(image []byte) string {
	sum := sha256.Sum256(image)
	return hex.EncodeToString(sum[:])
}

// portraitWork keeps the PLAYNC lookups apart: at most two run at a time, whether the
// job or a newly saved character started them, and never two for one character. At
// most ten newly saved characters wait for theirs (queued); the job looks up the rest,
// five a minute.
type portraitWork struct {
	mu      sync.Mutex
	idle    *sync.Cond // signalled when a lookup ends
	running map[string]bool
	queued  int
	slots   chan struct{}
}

const queuedPortraits = 10

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

// queue starts the lookup of a newly saved character, unless one runs for it already
// or ten wait, which leaves it to the job.
func (w *portraitWork) queue(app core.App, id string) {
	w.mu.Lock()
	if w.running[id] || w.queued >= queuedPortraits {
		w.mu.Unlock()
		return
	}
	w.running[id] = true
	w.queued++
	w.mu.Unlock()
	go func() {
		if err := w.run(app, id, true); err != nil {
			warn(app, "Odyle portrait lookup failed", "character", id, "error", message(err))
		}
	}()
}

// lookUp runs the claimed lookup of a character in one of the slots.
func (w *portraitWork) lookUp(app core.App, id string) error { return w.run(app, id, false) }

func (w *portraitWork) run(app core.App, id string, queued bool) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("the portrait lookup failed: %v", r)
		}
		w.mu.Lock()
		delete(w.running, id)
		if queued {
			w.queued--
		}
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
// at the job's next run, unless superusers paused portraits or ten wait already.
func watchCharacters(app core.App) {
	app.OnRecordAfterCreateSuccess("characters").BindFunc(func(e *core.RecordEvent) error {
		if !readSettings(e.App).PortraitsPaused {
			stateOf(e.App).portraits.queue(e.App, e.Record.Id)
		}
		return e.Next()
	})
}

// gamePortrait loads the official portrait into the character; the file is only
// rewritten when the image changed. Download errors are returned after the attempt is
// recorded. Never call it inside a transaction: it waits on PLAYNC. Portraits come only
// from the game; no route lets players set or replace them.
func gamePortrait(app core.App, id string) error {
	before, err := findAs[Character](app, "characters", id)
	if err != nil {
		return err
	}
	// A portrait the file storage does not hold (lost in a change of storage) is kept again,
	// whatever its digest.
	lost := before.Portrait() != "" && !portraitStored(app, before)
	found, hit, failure := fetchPortrait(serversOf(app), before.Name(), before.Server(), before.Region())
	// Read and written in one transaction after PLAYNC answered: a reading saved meanwhile
	// is kept. The lookup is noted in the character's bookkeeping (character_jobs); the
	// character itself is saved only when the lookup changed it (a new picture, its official
	// id, level or class), and its rooms hear of that from its record hooks (realtime.go).
	if err := app.RunInTransaction(func(tx core.App) error {
		c, err := findAs[Character](tx, "characters", id)
		if err != nil {
			return err
		}
		jobs, err := jobsOf(tx, id)
		if err != nil {
			return err
		}
		noted := map[string]any{"portraitCheckedAt": stamp(time.Now())}
		if found != nil && (found.hash != jobs.PortraitHash || c.Portrait() == "" || lost && c.Portrait() == before.Portrait()) {
			c.SetPortrait(found.file)
			noted["portraitHash"] = found.hash
		}
		// A failed lookup says nothing about the listing, so it is retried as before; each
		// lookup in a row that the search did not list the character waits longer.
		if failure == nil {
			noted["portraitMisses"] = 0
			if found == nil {
				noted["portraitMisses"] = jobs.PortraitMisses + 1
			}
		}
		// What the search lists besides the picture: the official id, level and class (#25).
		if hit.id != "" {
			setOfficial(tx, c, hit)
		}
		if changed(c.Record, "portrait", "officialId", "officialRegion", "officialServerId", "region", "level", "classId", "className") {
			if err := tx.Save(c); err != nil {
				return err
			}
		}
		return writeJobs(tx, id, noted)
	}); err != nil {
		return err
	}
	return failure
}

// portraitStored reports whether the file storage holds the character's portrait; true when it
// cannot tell.
func portraitStored(app core.App, c *Character) bool {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return true
	}
	defer fsys.Close()
	there, err := fsys.Exists(c.BaseFilesPath() + "/" + c.Portrait())
	return err != nil || there
}

// portraitsDue are the characters the job looks up: never looked up yet (saved while
// portraits were paused, or more than ten at once); with a portrait, daily; without
// one, an hour, six hours and a day after the first misses of the search, then weekly
// (a failed lookup keeps the pace of the misses so far). Characters no reader has seen
// for 60 days, or saved that long ago and never read, wait until a reader sees them. A
// character no job wrote yet has no bookkeeping row: it was never checked and missed none.
const portraitsDue = "SELECT c.id FROM {{characters}} c LEFT JOIN {{character_jobs}} j ON j.character = c.id " +
	"WHERE (c.lastSeenAt >= {:dormant} OR (c.lastSeenAt = '' AND c.created >= {:dormant})) AND (IFNULL(j.portraitCheckedAt, '') = '' OR (c.portrait != '' AND j.portraitCheckedAt < {:day}) OR " +
	"(c.portrait = '' AND ((j.portraitMisses <= 1 AND j.portraitCheckedAt < {:hour}) OR (j.portraitMisses = 2 AND j.portraitCheckedAt < {:hours}) OR (j.portraitMisses = 3 AND j.portraitCheckedAt < {:day}) OR j.portraitCheckedAt < {:week}))) " +
	"ORDER BY IFNULL(j.portraitCheckedAt, ''), c.created LIMIT {:limit}"

const dormantCharacters = 60 * 24 * time.Hour

// duePortraits are the ids of up to limit characters due, the longest unchecked first.
func duePortraits(app core.App, limit int) ([]string, error) {
	ids := []string{}
	err := app.DB().NewQuery(portraitsDue).Bind(dbx.Params{"dormant": ago(dormantCharacters), "hour": ago(time.Hour), "hours": ago(6 * time.Hour),
		"day": ago(24 * time.Hour), "week": ago(7 * 24 * time.Hour), "limit": limit}).Column(&ids)
	return ids, err
}

// refreshPortraits is a job: the characters due (portraitsDue) get their portrait, five
// per run, two at a time, so traffic to PLAYNC stays low; a character whose lookup runs
// already is left to it. Superusers can pause it (Server controls).
func refreshPortraits(app core.App) (result, error) {
	if readSettings(app).PortraitsPaused {
		return result{Skipped: "paused"}, nil
	}
	due, err := duePortraits(app, 5)
	if err != nil {
		return result{}, err
	}
	work := stateOf(app).portraits
	var mu sync.Mutex
	var wg sync.WaitGroup
	out := result{}
	for _, id := range due {
		if !work.claim(id) {
			continue
		}
		wg.Go(func() {
			err := work.lookUp(app, id)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				out.fail("Character " + id + ": " + message(err))
				warn(app, "Odyle portrait refresh failed", "character", id, "error", message(err))
				return
			}
			out.Done++
		})
	}
	wg.Wait()
	return out, nil
}
