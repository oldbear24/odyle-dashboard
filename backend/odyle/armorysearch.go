package odyle

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// lookUpArmory asks PLAYNC for a character's pages, keeps the images they name
// (armoryimages.go), shows that much to readers waiting for it (track), then asks for the
// details of its items and boards, keeps their images and then the profile. A character
// PLAYNC no longer lists loses its kept profile (unless hidden); another failure keeps the
// profile and notes the error. Never call it inside a transaction: it waits on PLAYNC.
func lookUpArmory(app core.App, j armoryJob, track *armoryTrack) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("the armory lookup failed: %v", r)
		}
	}()
	var profile armoryProfile
	track.begin("profile", 2, 1)
	info, err := askPLAYNC("info", j)
	if err == nil {
		var equipment map[string]any
		track.tick()
		time.Sleep(armoryStep)
		if equipment, err = askPLAYNC("equipment", j); err == nil {
			track.tick()
			if profile, err = readArmory(info, equipment); err == nil {
				track.plan(profile.detailed())
				keepArmoryImages(app, &profile, track, true)
				track.show(&profile)
				if err = detailArmory(&profile, j, track, true); err == nil {
					keepArmoryImages(app, &profile, track, false)
				}
			}
		}
	}
	// The kept profile is read and written after PLAYNC answered, in one transaction: a view
	// (viewedAt) or the hidden switch set meanwhile is kept.
	if txErr := app.RunInTransaction(func(tx core.App) error {
		record, findErr := keptProfile(tx, j.serverId, j.characterId)
		if findErr != nil {
			return findErr
		}
		if errors.Is(err, errArmoryMissing) {
			if record != nil && !record.GetBool("hidden") {
				return tx.Delete(record)
			}
			return nil
		}
		if record == nil {
			if err != nil {
				return nil
			}
			collection, findErr := tx.FindCollectionByNameOrId("armory_profiles")
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
		return tx.Save(record)
	}); txErr != nil {
		return txErr
	}
	// The character's row among the top players, with its gear (ranks.go); a character PLAYNC no
	// longer lists leaves them.
	if errors.Is(err, errArmoryMissing) {
		if rankErr := forgetRank(app, j.serverId, j.characterId); rankErr != nil {
			warn(app, "Odyle could not forget a character's rank", "error", message(rankErr))
		}
	} else if err == nil {
		if rankErr := keepRank(app, j.region, j.serverId, j.characterId, profile, true); rankErr != nil {
			warn(app, "Odyle could not keep a character's rank", "error", message(rankErr))
		}
	}
	// The page names the class of its class id, for every character with that id, and the
	// class's emblem is kept once (classes.go).
	if err == nil {
		if learnErr := learnClass(app, profile.pcId, profile.Class); learnErr != nil {
			warn(app, "Odyle could not keep a class name", "error", message(learnErr))
		}
		learnClassesFor(app, profile.Class)
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
// profile (or null) with its age and where its lookup stands. A profile kept in an older
// shape is asked for again, and ?refresh=1 asks PLAYNC again once the profile is
// armoryReaderRefresh old; every reader then sees that lookup until it ends. Public; rate
// limited per address.
func armoryRoute(e *core.RequestEvent) error {
	region, characterId := e.Request.PathValue("region"), e.Request.PathValue("characterId")
	serverId, _ := strconv.Atoi(e.Request.PathValue("serverId"))
	server := armoryServer(e.App, region, serverId)
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
	out := newObject().set("region", region).set("serverId", serverId).set("characterId", characterId).set("server", server).set("profile", nil).set("partial", false).set("classIcon", "").set("fetchedAt", "").set("error", "")
	var fetched time.Time
	var shown *keptMeta // what the profile shown says of itself, while it is an object
	outdated, incomplete := false, false
	if record != nil {
		fetched = record.GetDateTime("fetchedAt").Time()
		// The kept JSON goes out as it is, read only for what decides a lookup: a profile is
		// some 100 KB, which every view and every poll of a lookup parsed and wrote again.
		profile, meta := keptJSON(record.GetString("profile"))
		if meta != nil {
			outdated = number(meta.Version) < armoryVersion
			incomplete = number(meta.Missing) > 0
			shown = meta
		}
		out.set("profile", profile).set("fetchedAt", isoTime(fetched)).set("error", record.GetString("error"))
		// Opened: kept for another 30 days (written at most daily).
		if record.GetDateTime("viewedAt").Time().Before(time.Now().Add(-24 * time.Hour)) {
			if _, err := e.App.DB().NewQuery("UPDATE armory_profiles SET viewedAt = {:now} WHERE id = {:id}").Bind(dbx.Params{"now": stamp(time.Now()), "id": record.Id}).Execute(); err != nil {
				return err
			}
		}
	}
	age := time.Since(fetched)
	state := armoryState{State: "fresh"}
	// A profile some of whose details PLAYNC did not give is fetched again after an hour. One that
	// names an image the server no longer keeps (a restore, a change of the file storage) is
	// fetched again, which keeps its images, as a Refresh would: looked at only once that counts.
	due := record == nil || age > armoryRefresh || outdated || incomplete && age > armoryIncomplete
	if !due && age > armoryReaderRefresh {
		due = e.Request.URL.Query().Get("refresh") == "1" || imagesMissing(e.App, record.GetString("profile"))
	}
	if due {
		if readSettings(e.App).ArmoryPaused {
			state = armoryState{State: "paused"}
		} else {
			state = stateOf(e.App).armory.ask(e.App, armoryJob{key: armoryKey(serverId, characterId), region: region, serverId: serverId, characterId: characterId, address: e.RealIP()})
		}
	} else if pending, ok := stateOf(e.App).armory.peek(armoryKey(serverId, characterId)); ok {
		// A lookup a Refresh asked for: followed until it ends, never "fresh" meanwhile.
		state = pending
	}
	if state.State == "missing" {
		return notFound("PLAYNC does not list this character.")
	}
	// Without a kept profile in today's shape, the reader sees the one being read meanwhile.
	if state.Partial != "" && (record == nil || outdated) {
		profile, meta := keptJSON(state.Partial)
		out.set("profile", profile).set("partial", true)
		shown = meta
	}
	if shown != nil {
		class, _ := shown.Class.(string)
		out.set("classIcon", classIcons(e.App)[class])
	}
	// Its player card's look (cards.go), and whether the reader may change it.
	card, err := cardOf(e.App, region, serverId, characterId, e.Auth)
	if err != nil {
		return err
	}
	out.set("card", card)
	return e.JSON(200, out.set("state", state.State).set("position", state.Position).set("wait", state.Wait).set("retryAfter", state.RetryAfter).set("lookupError", state.Error).set("progress", state.Progress))
}

// keptMeta is what the armory route reads of a profile's JSON.
type keptMeta struct {
	Version any `json:"v"`
	Missing any `json:"missingDetails"`
	Class   any `json:"class"`
}

// keptJSON is a profile's JSON as it is sent (nil, for null, when it is empty or not JSON), and
// what it says of itself when it is an object (nil otherwise).
func keptJSON(raw string) (any, *keptMeta) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" || !json.Valid([]byte(trimmed)) {
		return nil, nil
	}
	if trimmed[0] != '{' {
		return json.RawMessage(trimmed), nil
	}
	meta := &keptMeta{}
	if json.Unmarshal([]byte(trimmed), meta) != nil {
		return nil, nil
	}
	return json.RawMessage(trimmed), meta
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
	Class       string `json:"class"`
	ClassIcon   string `json:"classIcon"`
	classId     int64
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
func (s *armorySearches) find(book serverBook, name, server, region string) ([]armoryHit, error) {
	key := region + "|" + server + "|" + strings.ToLower(name)
	s.mu.Lock()
	if kept, ok := s.kept[key]; ok && time.Since(kept.at) < armorySearchKeep {
		s.mu.Unlock()
		return kept.hits, nil
	}
	s.mu.Unlock()
	hits := []armoryHit{}
	for _, at := range book.searches(server, region) {
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
			hits = append(hits, armoryHit{Name: jsonText(hit, "name", 40), Level: whole(hit["level"]), Race: whole(hit["race"]), Server: server, ServerId: serverId, Region: at.region, CharacterId: id, classId: whole(hit["pcId"])})
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
	book := serversOf(e.App)
	if len(book.searches(server, region)) == 0 {
		return badRequest("Choose the region and server of the character.")
	}
	if readSettings(e.App).ArmoryPaused {
		return unavailable("The armory is paused for now. Try again later.")
	}
	hits, err := stateOf(e.App).armorySearch.find(book, name, server, region)
	if errors.Is(err, errArmoryBusy) {
		return unavailable("Many lookups at the moment. Try again in a minute.")
	}
	if err != nil {
		warn(e.App, "Odyle armory search failed", "error", message(err))
		return unavailable("The official character search did not answer. Try again in a minute.")
	}
	// Each hit's class and emblem, as far as the server knows its class id.
	classes, named := gameClasses(e.App), make([]armoryHit, len(hits))
	for i, hit := range hits {
		hit.Class, hit.ClassIcon = classes[hit.classId].Name, classes[hit.classId].Icon
		named[i] = hit
	}
	return e.JSON(200, map[string]any{"results": named})
}

// armoryServersRoute answers GET /api/odyle/armory/servers: the servers of each region by
// race, for the armory's search form, and with their ids, for the Windows app (servers.go): the
// ones PLAYNC last listed in the region, or every server known while it has listed none.
func armoryServersRoute(e *core.RequestEvent) error {
	book, out := serversOf(e.App), []map[string]any{}
	for _, r := range gameRegions {
		servers := book.regionServers(r.digit)
		races := map[int][]string{1: {}, 2: {}}
		for _, s := range servers {
			races[s.Id/1000] = append(races[s.Id/1000], s.Name)
		}
		out = append(out, map[string]any{"region": r.odyle, "elyos": races[1], "asmodian": races[2], "servers": servers})
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=3600")
	return e.JSON(200, map[string]any{"regions": out})
}
