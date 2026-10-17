package odyle

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The armory (#67): anyone, signed in or not, looks up an AION 2 Global character and sees
// its gear, combat power, item level and stats as PLAYNC's official character pages list
// them (/api/character/info and /equipment on aion2.plaync.com, docs/armory.md). Nothing
// in it is typed in or changed by players (R1) and no game packets are involved (R3).
//
// Profiles are kept in armory_profiles. A reader gets the kept copy at once, with its age;
// a profile not kept yet, or older than armoryRefresh, waits in one server-wide queue that
// asks PLAYNC for one profile at a time, armoryPace apart, so a reader may wait and the
// page says for how long. The queue takes armoryQueueSize profiles, at most
// armoryPerAddress from one address; PLAYNC refusing the server (403, 429) stops it for a
// while. Superusers pause it under Server controls and keep a profile out for good with
// its hidden switch (Collections → armory_profiles); profiles nobody opened for 30 days
// are deleted.

const (
	armoryRefresh       = 6 * time.Hour       // a kept profile older than this is fetched again when opened
	armoryReaderRefresh = 15 * time.Minute    // a reader's Refresh counts once the profile is this old
	armoryKeep          = 30 * 24 * time.Hour // profiles nobody opened this long are deleted
	armoryQueueSize     = 100
	armoryPerAddress    = 3
	armoryMissing       = time.Hour        // a character PLAYNC does not list is not asked for again before
	armoryRetry         = 10 * time.Minute // a failed lookup is not tried again before
	armoryBlocked       = 10 * time.Minute // PLAYNC refused the server without saying how long
	armorySearchKeep    = 10 * time.Minute // a search's results are kept this long
)

// armoryPace is the time between two profile lookups (two PLAYNC requests each), and
// armorySearchGap between two searches, server-wide; the test build shortens them.
var armoryPace, armorySearchGap = 5 * time.Second, time.Second

func armoryURL() string {
	if v := os.Getenv("PLAYNC_ARMORY_URL"); v != "" {
		return v
	}
	return "https://aion2.plaync.com"
}

// PLAYNC's character ids are URL-safe Base64 with padding.
var armoryIds = regexp.MustCompile(`^[A-Za-z0-9_-]{8,90}={0,2}$`)

// armoryServer is the name of a PLAYNC server id in a search region (searchRegions), or ""
// when the id does not belong to it: race * 1000 + region digit * 100 + list index + 1.
func armoryServer(region string, serverId int) string {
	for _, regions := range searchRegions {
		for _, r := range regions {
			if r.code != region || serverId/100%10 != r.digit {
				continue
			}
			at := serverId % 100
			names := map[int][]string{1: elyos, 2: asmodian}[serverId/1000]
			if at >= 1 && at <= len(names) && serverId < 3000 {
				return names[at-1]
			}
		}
	}
	return ""
}

// The profile the armory keeps and shows, read from PLAYNC's answers. Only what the
// official pages list publicly; skills, skins and titles' effects are left out.
type armoryProfile struct {
	pcId        int64
	Name        string        `json:"name"`
	Level       int64         `json:"level"`
	Class       string        `json:"class"`
	Race        string        `json:"race"`
	Server      string        `json:"server"`
	Title       string        `json:"title"`
	TitleGrade  string        `json:"titleGrade"`
	CombatPower int64         `json:"combatPower"`
	ItemLevel   int64         `json:"itemLevel"`
	Stats       []armoryStat  `json:"stats"`
	Gear        []armoryGear  `json:"gear"`
	Boards      []armoryBoard `json:"boards"`
}

// A stat: the six primary ones (STR, DEX, INT, CON, AGI, WIS) or a deity's ("Justice",
// deity "Nezekan").
type armoryStat struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Deity   string `json:"deity,omitempty"`
	Value   int64  `json:"value"`
	Primary bool   `json:"primary"`
}

// An equipped item by PLAYNC's slot name (MainHand, Earring1, Arcana3…, and Wings and Pet).
type armoryGear struct {
	Slot    string `json:"slot"`
	Name    string `json:"name"`
	Grade   string `json:"grade"`
	Enchant int64  `json:"enchant"`
	Exceed  int64  `json:"exceed"`
	Level   int64  `json:"level,omitempty"`
	order   int64
}

// A Daevanion board and how many of its nodes are open.
type armoryBoard struct {
	Name  string `json:"name"`
	Open  int64  `json:"open"`
	Total int64  `json:"total"`
}

var primaryStats = []string{"STR", "DEX", "INT", "CON", "AGI", "WIS"}

func jsonText(m map[string]any, key string, max int) string {
	s, _ := m[key].(string)
	return cut(collapse(tags.ReplaceAllString(s, "")), max)
}

func whole(v any) int64 { return int64(max(0, number(v))) }

func jsonObject(v any) map[string]any { m, _ := v.(map[string]any); return m }

func jsonList(v any) []map[string]any {
	list, _ := v.([]any)
	out := []map[string]any{}
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

var deityName = regexp.MustCompile(`^(.*?)\s*\[(.*?)\]$`)

var errArmoryAnswer = errors.New("PLAYNC answered something else than a character profile.")

// readArmory turns PLAYNC's info and equipment answers into the kept profile.
func readArmory(info, equipment map[string]any) (armoryProfile, error) {
	profile := jsonObject(info["profile"])
	p := armoryProfile{Name: jsonText(profile, "characterName", 40), Level: whole(profile["characterLevel"]), Class: jsonText(profile, "className", 40), Race: jsonText(profile, "raceName", 40),
		Server: jsonText(profile, "serverName", 40), Title: jsonText(profile, "titleName", 60), TitleGrade: jsonText(profile, "titleGrade", 20), CombatPower: whole(profile["combatPower"]),
		Stats: []armoryStat{}, Gear: []armoryGear{}, Boards: []armoryBoard{}, pcId: whole(profile["pcId"])}
	if p.Name == "" {
		return armoryProfile{}, errArmoryAnswer
	}
	for _, s := range jsonList(jsonObject(info["stat"])["statList"]) {
		kind := jsonText(s, "type", 20)
		if kind == "ItemLevel" {
			p.ItemLevel = whole(s["value"])
			continue
		}
		if kind == "" || len(p.Stats) >= 40 {
			continue
		}
		stat := armoryStat{Type: kind, Name: jsonText(s, "name", 40), Value: whole(s["value"]), Primary: slices.Contains(primaryStats, kind)}
		if m := deityName.FindStringSubmatch(stat.Name); m != nil {
			stat.Name, stat.Deity = m[1], m[2]
		}
		p.Stats = append(p.Stats, stat)
	}
	for _, g := range jsonList(jsonObject(equipment["equipment"])["equipmentList"]) {
		if len(p.Gear) < 40 {
			p.Gear = append(p.Gear, armoryGear{Slot: jsonText(g, "slotPosName", 20), Name: jsonText(g, "name", 80), Grade: jsonText(g, "grade", 20), Enchant: whole(g["enchantLevel"]), Exceed: whole(g["exceedLevel"]), order: whole(g["slotPos"])})
		}
	}
	slices.SortStableFunc(p.Gear, func(a, b armoryGear) int { return int(a.order - b.order) })
	companions := jsonObject(equipment["petwing"])
	if wing := jsonObject(companions["wing"]); jsonText(wing, "name", 80) != "" {
		p.Gear = append(p.Gear, armoryGear{Slot: "Wings", Name: jsonText(wing, "name", 80), Grade: jsonText(wing, "grade", 20), Enchant: whole(wing["enchantLevel"])})
	}
	if pet := jsonObject(companions["pet"]); jsonText(pet, "name", 80) != "" {
		p.Gear = append(p.Gear, armoryGear{Slot: "Pet", Name: jsonText(pet, "name", 80), Level: whole(pet["level"])})
	}
	for _, b := range jsonList(jsonObject(info["daevanion"])["boardList"]) {
		if len(p.Boards) < 10 {
			p.Boards = append(p.Boards, armoryBoard{Name: jsonText(b, "name", 40), Open: whole(b["openNodeCount"]), Total: whole(b["totalNodeCount"])})
		}
	}
	return p, nil
}

var errArmoryMissing = errors.New("PLAYNC does not list this character.")

// armoryRefused is PLAYNC refusing the server (403 or 429), and how long it asked to wait.
type armoryRefused struct{ wait time.Duration }

func (r armoryRefused) Error() string { return "PLAYNC refused the lookup for now." }

// askPLAYNC fetches one of a character's official pages ("info" or "equipment").
func askPLAYNC(kind, region string, serverId int, characterId string) (map[string]any, error) {
	query := "region=" + region + "&lang=en-US&characterId=" + url.QueryEscape(characterId) + "&serverId=" + strconv.Itoa(serverId)
	res, err := send(call{method: "GET", url: armoryURL() + "/api/character/" + kind + "?" + query, headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 15 * time.Second, limit: 1 << 20})
	if err != nil {
		return nil, err
	}
	switch {
	case res.status == 404:
		return nil, errArmoryMissing
	case res.status == 403 || res.status == 429:
		return nil, armoryRefused{wait: retryAfter(res)}
	case res.status != 200:
		return nil, fmt.Errorf("PLAYNC answered %d.", res.status)
	}
	found, ok := res.json().(map[string]any)
	if !ok {
		return nil, errArmoryAnswer
	}
	return found, nil
}

// armoryJob is a profile waiting for its lookup, and the address that asked for it.
type armoryJob struct {
	key, region, characterId, address string
	serverId                          int
}

func armoryKey(serverId int, characterId string) string {
	return strconv.Itoa(serverId) + "/" + characterId
}

// armoryMiss keeps a character that could not be looked up from being asked for again
// before until.
type armoryMiss struct {
	until   time.Time
	missing bool // PLAYNC does not list it
	error   string
}

// armoryState is where a profile's lookup stands, for the reader: queued (position profiles
// ahead, about wait seconds), fetching, failed (error), busy (the queue or the address has
// no room), paused, missing or fresh (nothing to do).
type armoryState struct {
	State      string
	Position   int
	Wait       int
	RetryAfter int
	Error      string
}

// armoryWork is the queue of profiles waiting for PLAYNC. One goroutine works it while it
// holds any; it ends when the queue is empty.
type armoryWork struct {
	mu        sync.Mutex
	idle      *sync.Cond    // signalled when the worker ends
	wake      chan struct{} // ends the worker's wait (dropped queue)
	waiting   []armoryJob
	current   string
	byAddress map[string]int
	misses    map[string]armoryMiss
	working   bool
	nextAt    time.Time // the next lookup starts no earlier
	blocked   time.Time // PLAYNC refused the server until then
	lastAt    time.Time
	lastError string
	errorAt   time.Time
	done      int
	failed    int
}

func newArmoryWork() *armoryWork {
	w := &armoryWork{byAddress: map[string]int{}, misses: map[string]armoryMiss{}, wake: make(chan struct{}, 1)}
	w.idle = sync.NewCond(&w.mu)
	return w
}

// later is the latest of the times.
func later(times ...time.Time) time.Time {
	out := times[0]
	for _, t := range times[1:] {
		if t.After(out) {
			out = t
		}
	}
	return out
}

// seconds is d in whole seconds, rounded up.
func seconds(d time.Duration) int { return int((max(0, d) + time.Second - 1) / time.Second) }

// queued is the state of the profile at index i of the queue. Its wait counts the lookup
// running now and the ones ahead, each armoryPace apart.
func (w *armoryWork) queued(i int, at time.Time) armoryState {
	start := later(w.nextAt, w.blocked, at)
	ahead := i
	if w.current != "" {
		ahead++
		start = later(start, at.Add(armoryPace))
	}
	wait := seconds(start.Sub(at) + time.Duration(i)*armoryPace + 2*time.Second)
	return armoryState{State: "queued", Position: ahead, Wait: wait, RetryAfter: min(max(wait, 2), 15)}
}

// ask queues a profile for its lookup, unless it waits or runs already, or failed a moment
// ago, and says where it stands.
func (w *armoryWork) ask(app core.App, j armoryJob) armoryState {
	w.mu.Lock()
	defer w.mu.Unlock()
	at := time.Now()
	if miss, ok := w.misses[j.key]; ok {
		if at.Before(miss.until) {
			if miss.missing {
				return armoryState{State: "missing", Error: errArmoryMissing.Error()}
			}
			return armoryState{State: "failed", Error: miss.error, RetryAfter: seconds(miss.until.Sub(at))}
		}
		delete(w.misses, j.key)
	}
	if w.current == j.key {
		return armoryState{State: "fetching", RetryAfter: 2}
	}
	for i, q := range w.waiting {
		if q.key == j.key {
			return w.queued(i, at)
		}
	}
	if len(w.waiting) >= armoryQueueSize || w.byAddress[j.address] >= armoryPerAddress {
		return armoryState{State: "busy", RetryAfter: 30}
	}
	w.waiting = append(w.waiting, j)
	w.byAddress[j.address]++
	if !w.working {
		w.working = true
		go w.work(app)
	}
	return w.queued(len(w.waiting)-1, at)
}

// drop empties the queue (paused), and wakes a worker waiting for PLAYNC so it ends.
func (w *armoryWork) drop() {
	w.waiting, w.byAddress = nil, map[string]int{}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *armoryWork) work(app core.App) {
	for {
		paused := readSettings(app).ArmoryPaused
		w.mu.Lock()
		if paused {
			w.drop()
		}
		if len(w.waiting) == 0 {
			w.working = false
			w.mu.Unlock()
			w.idle.Broadcast()
			return
		}
		if wait := time.Until(later(w.nextAt, w.blocked)); wait > 0 {
			w.mu.Unlock()
			select {
			case <-time.After(wait):
			case <-w.wake:
			}
			continue
		}
		j := w.waiting[0]
		w.waiting = w.waiting[1:]
		if w.byAddress[j.address]--; w.byAddress[j.address] <= 0 {
			delete(w.byAddress, j.address)
		}
		w.current = j.key
		w.mu.Unlock()
		err := lookUpArmory(app, j)
		w.mu.Lock()
		at := time.Now()
		w.current, w.lastAt, w.nextAt = "", at, at.Add(armoryPace)
		var refused armoryRefused
		switch {
		case err == nil:
			w.done++
		case errors.Is(err, errArmoryMissing):
			w.misses[j.key] = armoryMiss{until: at.Add(armoryMissing), missing: true}
		default:
			w.failed++
			w.lastError, w.errorAt = message(err), at
			w.misses[j.key] = armoryMiss{until: at.Add(armoryRetry), error: message(err)}
			if errors.As(err, &refused) {
				w.blocked = at.Add(max(refused.wait, armoryBlocked))
			}
			warn(app, "Odyle armory lookup failed", "character", j.key, "error", message(err))
		}
		// Old misses go once there are many.
		if len(w.misses) > 1000 {
			for key, miss := range w.misses {
				if at.After(miss.until) {
					delete(w.misses, key)
				}
			}
		}
		w.mu.Unlock()
	}
}

// wait returns once the queue is worked off (tests).
func (w *armoryWork) wait() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for w.working {
		w.idle.Wait()
	}
}

// lookUpArmory asks PLAYNC for a character's pages and keeps the profile. A character
// PLAYNC no longer lists loses its kept profile (unless hidden); another failure keeps the
// profile and notes the error. Never call it inside a transaction: it waits on PLAYNC.
func lookUpArmory(app core.App, j armoryJob) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("the armory lookup failed: %v", r)
		}
	}()
	var profile armoryProfile
	info, err := askPLAYNC("info", j.region, j.serverId, j.characterId)
	if err == nil {
		var equipment map[string]any
		if equipment, err = askPLAYNC("equipment", j.region, j.serverId, j.characterId); err == nil {
			profile, err = readArmory(info, equipment)
		}
	}
	record, findErr := keptProfile(app, j.serverId, j.characterId)
	if findErr != nil {
		return findErr
	}
	if errors.Is(err, errArmoryMissing) {
		if record != nil && !record.GetBool("hidden") {
			if deleteErr := app.Delete(record); deleteErr != nil {
				return deleteErr
			}
		}
		return err
	}
	if record == nil {
		if err != nil {
			return err
		}
		collection, findErr := app.FindCollectionByNameOrId("armory_profiles")
		if findErr != nil {
			return findErr
		}
		record = core.NewRecord(collection)
		record.Set("region", j.region)
		record.Set("serverId", j.serverId)
		record.Set("characterId", j.characterId)
		record.Set("viewedAt", now())
	}
	if err != nil {
		record.Set("error", cut(message(err), 300))
	} else {
		record.Set("name", profile.Name)
		record.Set("profile", profile)
		record.Set("fetchedAt", now())
		record.Set("error", "")
	}
	if saveErr := app.Save(record); saveErr != nil {
		return saveErr
	}
	// The page names the class of its class id, for every character with that id (classes.go).
	if err == nil {
		if learnErr := learnClass(app, profile.pcId, profile.Class); learnErr != nil {
			warn(app, "Odyle could not keep a class name", "error", message(learnErr))
		}
	}
	return err
}

func keptProfile(app core.App, serverId int, characterId string) (*core.Record, error) {
	record, err := app.FindFirstRecordByFilter("armory_profiles", "serverId = {:server} && characterId = {:id}", dbx.Params{"server": serverId, "id": characterId})
	if isNoRows(err) {
		return nil, nil
	}
	return record, err
}

// isoTime is t as an ISO time, or "" when it is zero.
func isoTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(isoLayout)
}

// armoryRoute answers GET /api/odyle/armory/{region}/{serverId}/{characterId}: the kept
// profile (or null) with its age and where its lookup stands. ?refresh=1 asks PLAYNC again
// once the profile is armoryReaderRefresh old. Public; rate limited per address.
func armoryRoute(e *core.RequestEvent) error {
	region, characterId := e.Request.PathValue("region"), e.Request.PathValue("characterId")
	serverId, _ := strconv.Atoi(e.Request.PathValue("serverId"))
	server := armoryServer(region, serverId)
	if server == "" || !armoryIds.MatchString(characterId) {
		return notFound("This character is not in the armory.")
	}
	record, err := keptProfile(e.App, serverId, characterId)
	if err != nil {
		return err
	}
	if record != nil && record.GetBool("hidden") {
		return notFound("This character is not in the armory.")
	}
	out := newObject().set("region", region).set("serverId", serverId).set("characterId", characterId).set("server", server).set("profile", nil).set("fetchedAt", "").set("error", "")
	var fetched time.Time
	if record != nil {
		fetched = record.GetDateTime("fetchedAt").Time()
		out.set("profile", parseJSON(record.GetString("profile"), "null")).set("fetchedAt", isoTime(fetched)).set("error", record.GetString("error"))
		// Opened: kept for another 30 days (written at most daily).
		if record.GetDateTime("viewedAt").Time().Before(time.Now().Add(-24 * time.Hour)) {
			if _, err := e.App.DB().NewQuery("UPDATE armory_profiles SET viewedAt = {:now} WHERE id = {:id}").Bind(dbx.Params{"now": stamp(time.Now()), "id": record.Id}).Execute(); err != nil {
				return err
			}
		}
	}
	age := time.Since(fetched)
	state := armoryState{State: "fresh"}
	if record == nil || age > armoryRefresh || e.Request.URL.Query().Get("refresh") == "1" && age > armoryReaderRefresh {
		if readSettings(e.App).ArmoryPaused {
			state = armoryState{State: "paused"}
		} else {
			state = stateOf(e.App).armory.ask(e.App, armoryJob{key: armoryKey(serverId, characterId), region: region, serverId: serverId, characterId: characterId, address: e.RealIP()})
		}
	}
	if state.State == "missing" {
		return notFound("PLAYNC does not list this character.")
	}
	return e.JSON(200, out.set("state", state.State).set("position", state.Position).set("wait", state.Wait).set("retryAfter", state.RetryAfter).set("lookupError", state.Error))
}

// armoryHit is a character the official search lists.
type armoryHit struct {
	Name        string `json:"name"`
	Level       int64  `json:"level"`
	Race        int64  `json:"race"`
	Server      string `json:"server"`
	ServerId    int    `json:"serverId"`
	Region      string `json:"region"`
	CharacterId string `json:"characterId"`
}

type searchAnswer struct {
	hits []armoryHit
	at   time.Time
}

// armorySearches keeps the searches of the last ten minutes and spaces those sent to
// PLAYNC armorySearchGap apart, server-wide.
type armorySearches struct {
	mu   sync.Mutex
	kept map[string]searchAnswer
	next time.Time
}

func newArmorySearches() *armorySearches { return &armorySearches{kept: map[string]searchAnswer{}} }

var errArmoryBusy = errors.New("Many lookups at the moment. Try again in a minute.")

// slot reserves the next moment a search may go to PLAYNC, waiting up to three seconds.
func (s *armorySearches) slot() error {
	s.mu.Lock()
	at := later(s.next, time.Now())
	if time.Until(at) > 3*time.Second {
		s.mu.Unlock()
		return errArmoryBusy
	}
	s.next = at.Add(armorySearchGap)
	s.mu.Unlock()
	time.Sleep(time.Until(at))
	return nil
}

// find lists the characters the official search finds by a name on a server (searches),
// those named exactly so first, at most 20.
func (s *armorySearches) find(name, server, region string) ([]armoryHit, error) {
	key := region + "|" + server + "|" + strings.ToLower(name)
	s.mu.Lock()
	if kept, ok := s.kept[key]; ok && time.Since(kept.at) < armorySearchKeep {
		s.mu.Unlock()
		return kept.hits, nil
	}
	s.mu.Unlock()
	hits := []armoryHit{}
	for _, at := range searches(server, region) {
		if err := s.slot(); err != nil {
			return nil, err
		}
		query := "keyword=" + strings.ReplaceAll(url.QueryEscape(name), "+", "%20") + "&serverId=" + strconv.Itoa(at.serverId) + "&region=" + at.region + "&localeInfo=en-US&page=1&size=" + strconv.Itoa(searchPageSize)
		res, err := send(call{method: "GET", url: searchURL() + "?" + query, headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 10 * time.Second, limit: 1 << 20})
		if err != nil {
			return nil, err
		}
		if res.status != 200 {
			return nil, errors.New("The official character search is unavailable (" + strconv.Itoa(res.status) + ").")
		}
		found, _ := res.json().(map[string]any)
		for _, hit := range jsonList(found["list"]) {
			id, err := url.QueryUnescape(jsonText(hit, "characterId", 200))
			serverId := int(number(hit["serverId"]))
			if err != nil || !armoryIds.MatchString(id) || serverId != at.serverId {
				continue
			}
			hits = append(hits, armoryHit{Name: jsonText(hit, "name", 40), Level: whole(hit["level"]), Race: whole(hit["race"]), Server: server, ServerId: serverId, Region: at.region, CharacterId: id})
		}
	}
	exact := strings.ToLower(name)
	slices.SortStableFunc(hits, func(a, b armoryHit) int {
		return boolOrder(strings.ToLower(b.Name) == exact) - boolOrder(strings.ToLower(a.Name) == exact)
	})
	hits = hits[:min(len(hits), 20)]
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.kept) >= 500 {
		for k, kept := range s.kept {
			if time.Since(kept.at) >= armorySearchKeep {
				delete(s.kept, k)
			}
		}
		if len(s.kept) >= 500 {
			s.kept = map[string]searchAnswer{}
		}
	}
	s.kept[key] = searchAnswer{hits: hits, at: time.Now()}
	return hits, nil
}

func boolOrder(b bool) int {
	if b {
		return 1
	}
	return 0
}

// armoryName checks a searched name: 2 to 16 letters or digits.
func armoryName(name string) bool {
	runes := []rune(name)
	if len(runes) < 2 || len(runes) > 16 {
		return false
	}
	for _, r := range runes {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

// armorySearchRoute answers GET /api/odyle/armory/search?name=&server=&region= (a server
// name and an Odyle region, as characters keep them): the characters the official search
// lists. Public; rate limited per address.
func armorySearchRoute(e *core.RequestEvent) error {
	q := e.Request.URL.Query()
	name, server, region := trim(q.Get("name")), q.Get("server"), q.Get("region")
	if !armoryName(name) {
		return badRequest("Search a character name of 2 to 16 letters or digits.")
	}
	if len(searches(server, region)) == 0 {
		return badRequest("Choose the region and server of the character.")
	}
	if readSettings(e.App).ArmoryPaused {
		return unavailable("The armory is paused for now. Try again later.")
	}
	hits, err := stateOf(e.App).armorySearch.find(name, server, region)
	if errors.Is(err, errArmoryBusy) {
		return unavailable("Many lookups at the moment. Try again in a minute.")
	}
	if err != nil {
		warn(e.App, "Odyle armory search failed", "error", message(err))
		return unavailable("The official character search did not answer. Try again in a minute.")
	}
	return e.JSON(200, map[string]any{"results": hits})
}

// armoryServersRoute answers GET /api/odyle/armory/servers: the servers of each region by
// race, for the armory's search form.
func armoryServersRoute(e *core.RequestEvent) error {
	regions := []string{"GLOBAL_NA", "GLOBAL_NAW", "GLOBAL_EU", "GLOBAL_SA", "GLOBAL_ASIA"}
	out := []map[string]any{}
	for _, r := range regions {
		out = append(out, map[string]any{"region": r, "elyos": elyos, "asmodian": asmodian})
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=86400")
	return e.JSON(200, map[string]any{"regions": out})
}

// cleanArmory is a job: profiles nobody opened for 30 days are deleted, hidden ones kept.
func cleanArmory(app core.App) (result, error) {
	res, err := app.DB().NewQuery("DELETE FROM armory_profiles WHERE hidden = FALSE AND viewedAt < {:before}").Bind(dbx.Params{"before": ago(armoryKeep)}).Execute()
	if err != nil {
		return result{}, err
	}
	deleted, _ := res.RowsAffected()
	return result{Done: int(deleted)}, nil
}

// armoryStatus is the armory's part of the Server status page.
func armoryStatus(app core.App) map[string]any {
	w := stateOf(app).armory
	w.mu.Lock()
	out := map[string]any{"waiting": len(w.waiting), "fetching": w.current != "", "done": w.done, "failed": w.failed, "lastAt": isoTime(w.lastAt), "lastError": w.lastError,
		"lastErrorAt": isoTime(w.errorAt), "blockedUntil": ""}
	if w.blocked.After(time.Now()) {
		out["blockedUntil"] = isoTime(w.blocked)
	}
	w.mu.Unlock()
	var kept, hidden int
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM armory_profiles").Row(&kept)
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM armory_profiles WHERE hidden = TRUE").Row(&hidden)
	out["profiles"], out["hidden"], out["paused"] = kept, hidden, readSettings(app).ArmoryPaused
	return out
}
