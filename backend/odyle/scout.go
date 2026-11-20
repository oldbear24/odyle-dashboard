package odyle

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The scout: PLAYNC's Global pages list no rankings and its character search cannot sort by
// combat power (docs/armory.md), so to know the strongest characters of each class the armory
// reads PLAYNC's public pages slowly in the background, on top of the profiles readers open. A
// run of the odyle-armory-scout job (every minute, paused with the armory) asks for scoutSteps
// pages, scoutStep apart, one per step:
//
//   - at most every scoutBuildGap, and while no reader's lookup waits, it queues the scout's
//     lookup of the strongest character of a class's top rankLimit whose gear is unknown or
//     scoutRebuild old: the armory's queue runs one such at a time, beside the readers' (armory.go),
//     reading its info and equipment pages and each item's page as a lookup does, and keeps it as
//     its build in armory_ranks (ranks.go), with the icons but no portrait and no profile;
//   - a character the last search page listed: its info page, for its combat power;
//   - else a page of PLAYNC's character search: a random open server, class, letter and page,
//     the characters of the highest level listed that were not checked for rankKeep.
//
// That is some 7,000 pages a day, and a character's gear every few minutes at most. The armory's
// pause stops it, and PLAYNC refusing the server stops it with the armory's queue.

const (
	scoutSteps    = 5
	scoutBuildGap = 3 * time.Minute
	scoutRebuild  = 14 * 24 * time.Hour
	scoutPageSize = 40
	scoutHits     = 200 // characters from search pages waiting to be checked, at most
)

// scoutStep is the time between two of the scout's pages, and scoutPick how it picks a server,
// class, letter and page (0 to n-1); the tests shorten the one and settle the other.
var scoutStep, scoutPick = 10 * time.Second, rand.IntN

// scoutLetters are what the scout searches names for: the search needs a keyword, and a name
// holds one of these more often than not.
var scoutLetters = []string{"a", "e", "i", "o", "u", "y", "n", "r", "l", "s", "t", "k", "m", "d"}

// scoutHit is a character a search page listed.
type scoutHit struct {
	region, characterId string
	serverId            int
}

// armoryScout is what the scout remembers between its pages, in server memory: the characters
// the last search pages listed, how many pages each search has, the highest level met (lower
// characters are passed over) and when it last read a character's gear.
type armoryScout struct {
	mu      sync.Mutex
	hits    []scoutHit
	pages   map[string]int
	level   int64
	builtAt time.Time
}

func newArmoryScout() *armoryScout { return &armoryScout{pages: map[string]int{}} }

// scoutArmory is the odyle-armory-scout job: the profiles kept before 0.62.0 join the top players
// (no request to PLAYNC), then, unless the armory is paused or PLAYNC refused the server, up to
// scoutSteps pages.
func scoutArmory(app core.App) (result, error) {
	out := result{}
	ranked, err := rankKeptProfiles(app, 200)
	out.Done += ranked
	if err != nil {
		return out, err
	}
	s := stateOf(app).scout
	for i := 0; i < scoutSteps; i++ {
		if i > 0 {
			time.Sleep(scoutStep)
		}
		if readSettings(app).ArmoryPaused || stateOf(app).armory.refusedUntil().After(time.Now()) {
			if i == 0 {
				out.Skipped = "paused"
			}
			break
		}
		asked, err := s.step(app)
		var refused armoryRefused
		if errors.As(err, &refused) {
			stateOf(app).armory.refuse(refused)
			out.fail(message(err))
			break
		}
		if err != nil {
			out.fail(message(err))
		} else if asked {
			out.Done++
		}
	}
	return out, nil
}

// refusedUntil is when PLAYNC lets the server ask again (zero while it does).
func (w *armoryWork) refusedUntil() time.Time {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.blocked
}

// refuse stops the armory's queue (and the scout) for as long as PLAYNC asked, and at least
// armoryBlocked.
func (w *armoryWork) refuse(r armoryRefused) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.blocked = later(w.blocked, time.Now().Add(max(r.wait, armoryBlocked)))
}

// step queues a top character's gear when it is time to, then asks PLAYNC for one page, and says
// whether it asked.
func (s *armoryScout) step(app core.App) (bool, error) {
	// More lanes for the scout (Server controls) read gear more often: every scoutBuildGap
	// divided among them, none while it has none.
	lanes := readSettings(app).ScoutLanes
	s.mu.Lock()
	building := lanes > 0 && time.Since(s.builtAt) >= scoutBuildGap/time.Duration(max(1, lanes))
	s.mu.Unlock()
	if building {
		hit, ok, err := nextBuild(app)
		if err != nil {
			return false, err
		}
		if ok && stateOf(app).armory.scout(app, hit) {
			s.mu.Lock()
			s.builtAt = time.Now()
			s.mu.Unlock()
		}
	}
	if hit, ok := s.next(); ok {
		return true, checkRank(app, hit)
	}
	return s.search(app)
}

// next takes the next character the search pages listed.
func (s *armoryScout) next() (scoutHit, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.hits) == 0 {
		return scoutHit{}, false
	}
	hit := s.hits[0]
	s.hits = s.hits[1:]
	return hit, true
}

// nextBuild is the strongest character in its class's top whose gear is unknown or old.
func nextBuild(app core.App) (scoutHit, bool, error) {
	var hit scoutHit
	err := app.DB().NewQuery("SELECT region, serverId, characterId FROM armory_ranks WHERE id IN ("+inTop+") AND (builtAt = '' OR builtAt < {:old}) ORDER BY combatPower DESC, id LIMIT 1").
		Bind(dbx.Params{"limit": rankLimit, "old": ago(scoutRebuild)}).Row(&hit.region, &hit.serverId, &hit.characterId)
	if isNoRows(err) {
		return hit, false, nil
	}
	return hit, err == nil, err
}

func (h scoutHit) job() armoryJob {
	return armoryJob{key: armoryKey(h.serverId, h.characterId), region: h.region, serverId: h.serverId, characterId: h.characterId}
}

// checkRank reads a character's info page and keeps its combat power; a character PLAYNC no
// longer lists is forgotten.
func checkRank(app core.App, hit scoutHit) error {
	info, err := askPLAYNC("info", hit.job())
	if errors.Is(err, errArmoryMissing) {
		return forgetRank(app, hit.serverId, hit.characterId)
	}
	if err != nil {
		return err
	}
	p, err := readArmory(info, map[string]any{})
	if err != nil {
		return err
	}
	learnRankClass(app, p)
	return keepRank(app, hit.region, hit.serverId, hit.characterId, p, false)
}

// buildRank is the scout's lookup in the armory's queue: it reads a character's gear as a reader's
// lookup does (info, equipment, each item's page; not the boards', whose open nodes the info page
// lists) and keeps it as its build, with the icons it names but not its portrait.
func buildRank(app core.App, hit scoutHit, track *armoryTrack) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("the scout's lookup failed: %v", r)
		}
	}()
	j := hit.job()
	track.begin("profile", 2, 1)
	info, err := askPLAYNC("info", j)
	if errors.Is(err, errArmoryMissing) {
		return forgetRank(app, hit.serverId, hit.characterId)
	}
	if err != nil {
		return err
	}
	track.tick()
	time.Sleep(armoryStep)
	equipment, err := askPLAYNC("equipment", j)
	if err != nil {
		return err
	}
	track.tick()
	p, err := readArmory(info, equipment)
	if err != nil {
		return err
	}
	items, _ := p.detailed()
	track.plan(items, 0)
	if err := detailArmory(&p, j, track, false); err != nil {
		return err
	}
	keepArmoryImages(app, &p, track, false)
	learnRankClass(app, p)
	return keepRank(app, hit.region, hit.serverId, hit.characterId, p, true)
}

// learnRankClass names the class of the page's class id, as a lookup does (classes.go).
func learnRankClass(app core.App, p armoryProfile) {
	if err := learnClass(app, p.pcId, p.Class); err != nil {
		warn(app, "Odyle could not keep a class name", "error", message(err))
	}
}

// search reads a page of PLAYNC's character search for a random open server, class, letter and
// page, and keeps the characters of the highest level it lists that were not checked for
// rankKeep, in a random order. It says whether it asked PLAYNC.
func (s *armoryScout) search(app core.App) (bool, error) {
	classes := map[string][]string{}
	names := []string{}
	for id, c := range gameClasses(app) {
		if c.Name != "" {
			if classes[c.Name] == nil {
				names = append(names, c.Name)
			}
			classes[c.Name] = append(classes[c.Name], strconv.FormatInt(id, 10))
		}
	}
	book := serversOf(app)
	digit := 1 + scoutPick(5)
	servers := book.regionServers(digit)
	if len(names) == 0 || len(servers) == 0 {
		return false, nil
	}
	slices.Sort(names)
	server, class, letter := servers[scoutPick(len(servers))], names[scoutPick(len(names))], scoutLetters[scoutPick(len(scoutLetters))]
	key := fmt.Sprintf("%d|%s|%s", server.Id, class, letter)
	s.mu.Lock()
	page := 1 + scoutPick(max(1, s.pages[key]))
	s.mu.Unlock()
	if err := stateOf(app).armorySearch.slot(); err != nil {
		return false, nil // readers' searches first
	}
	region := serverRegionCodes[digit]
	query := "keyword=" + letter + "&pcId=" + url.QueryEscape(strings.Join(classes[class], ",")) + "&serverId=" + strconv.Itoa(server.Id) + "&region=" + region +
		"&localeInfo=en-US&page=" + strconv.Itoa(page) + "&size=" + strconv.Itoa(scoutPageSize) + "&sort=level"
	res, err := send(call{method: "GET", url: searchURL() + "?" + query, headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 10 * time.Second, limit: 1 << 20})
	if err != nil {
		return true, err
	}
	switch {
	case res.status == 403 || res.status == 429:
		return true, armoryRefused{wait: retryAfter(res)}
	case res.status != 200:
		return true, errors.New("The official character search is unavailable (" + strconv.Itoa(res.status) + ").")
	}
	found, _ := res.json().(map[string]any)
	hits := []scoutHit{}
	s.mu.Lock()
	// PLAYNC lists up to 10,000 characters of a search.
	s.pages[key] = min(int(whole(jsonObject(found["pagination"])["endPage"])), 10000/scoutPageSize)
	for _, h := range jsonList(found["list"]) {
		id, err := url.QueryUnescape(jsonText(h, "characterId", 200))
		level := whole(h["level"])
		if err != nil || !armoryIds.MatchString(id) || int(number(h["serverId"])) != server.Id || level < s.level {
			continue
		}
		if level > s.level {
			s.level, hits = level, hits[:0]
		}
		hits = append(hits, scoutHit{region: region, serverId: server.Id, characterId: id})
	}
	s.mu.Unlock()
	if len(hits) == 0 {
		return true, nil
	}
	// Characters checked for rankKeep, or hidden, are passed over.
	ids := make([]any, len(hits))
	for i, h := range hits {
		ids[i] = h.characterId
	}
	known := []string{}
	if err := app.DB().Select("characterId").From("armory_ranks").Where(dbx.HashExp{"serverId": server.Id, "characterId": ids}).
		AndWhere(dbx.NewExp("checkedAt >= {:recent} OR hidden = TRUE", dbx.Params{"recent": ago(rankKeep)})).Column(&known); err != nil {
		return true, err
	}
	rand.Shuffle(len(hits), func(i, j int) { hits[i], hits[j] = hits[j], hits[i] })
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, h := range hits {
		if !slices.Contains(known, h.characterId) && len(s.hits) < scoutHits {
			s.hits = append(s.hits, h)
		}
	}
	return true, nil
}
