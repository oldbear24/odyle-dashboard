package odyle

import (
	"cmp"
	"errors"
	"fmt"
	"math"
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
//   - while no reader's lookup waits, it queues the scout's lookups of the strongest characters of
//     a class's top rankLimit whose gear is unknown or scoutRebuild old (once none is, of characters
//     below the top, a few of each band of combat power: pendingPeers), as many as its lanes
//     (scoutLanes under Server controls) have free, each lane one every scoutBuildGap at most,
//     passing over the characters whose gear is read already or whose lookup failed lately: the
//     armory's queue runs them beside the readers' (armoryqueue.go), reading the info and equipment
//     pages and each item's page as a lookup does, and keeps each as its build in armory_ranks
//     (ranks.go), with the icons but no portrait and no profile;
//   - a character the last search page listed (by id and name): its info page, for its combat
//     power;
//   - else a character an Odyle account plays, whose PLAYNC id the portrait lookup learned
//     (portraits.go): its info page, without a search;
//   - else a player Odyle met by name: a party or force member a Windows app sent
//     (teammates.go), else one of the players of the PvP events kept (pvp.go); a search for the
//     name on their server, as the portrait lookup searches, and the character it lists is
//     checked next;
//   - else a page of PLAYNC's character search: a random open server, class, letter and page,
//     the characters of the highest level listed that were not checked for rankKeep.
//
// Only characters of the highest level its searches met are checked: before its first search it
// checks nobody else. That is some 7,000 pages a day, and a character's gear every few minutes at
// most. The armory's pause stops it, and PLAYNC refusing the server stops it with the armory's
// queue.

const (
	scoutSteps    = 5
	scoutBuildGap = 3 * time.Minute
	scoutRebuild  = 14 * 24 * time.Hour
	scoutPageSize = 40
	scoutHits     = 200   // characters from search pages waiting to be checked, at most
	scoutNames    = 500   // party and force members waiting to be searched for, at most
	scoutNamesBy  = 100   // of them sent by one account, at most
	scoutTried    = 50000 // names and characters remembered as tried, at most
	scoutPicks    = 50    // Odyle's characters, PvP players or top players a step picks from
	scoutOwnRetry = 24 * time.Hour
)

// scoutStep is the time between two of the scout's pages, and scoutPick how it picks a server,
// class, letter and page (0 to n-1); the tests shorten the one and settle the other.
var scoutStep, scoutPick = 10 * time.Second, rand.IntN

// scoutLetters are what the scout searches names for: the search needs a keyword, and a name
// holds one of these more often than not.
var scoutLetters = []string{"a", "e", "i", "o", "u", "y", "n", "r", "l", "s", "t", "k", "m", "d"}

// scoutHit is a character a search page listed, with its name and class when the page named
// them (Server status shows them before its info page is read).
type scoutHit struct {
	region, characterId string
	serverId            int
	name, class         string
}

// scoutName is a player the scout looks for by name, on their server (its name) and in their
// Odyle region (GLOBAL_EU), as characters are saved.
type scoutName struct {
	name, server, region string
	by                   string // the account whose app sent the name
}

func (n scoutName) key() string {
	return "name|" + strings.ToLower(n.name) + "|" + n.server + "|" + n.region
}

// armoryScout is what the scout remembers between its pages, in server memory: the characters
// the last search pages listed, the party and force members waiting to be searched for, the
// names and characters it tried lately (until when it passes them over), how many pages each
// search has, the highest level met (lower characters are passed over) and when it last queued
// characters' gear (the latest last, at most maxScoutLanes).
type armoryScout struct {
	mu    sync.Mutex
	hits  []scoutHit
	names []scoutName
	tried map[string]time.Time
	pages map[string]int
	level int64
	built []time.Time
}

func newArmoryScout() *armoryScout {
	return &armoryScout{pages: map[string]int{}, tried: map[string]time.Time{}}
}

// buildsDue is how many characters' gear the scout may queue now with lanes lanes: each lane one
// every scoutBuildGap, so up to lanes at once (s.mu held).
func (s *armoryScout) buildsDue(lanes int, at time.Time) int {
	recent := 0
	for _, t := range s.built {
		if at.Sub(t) < scoutBuildGap {
			recent++
		}
	}
	return max(0, lanes-recent)
}

// queuedBuilds remembers n characters' gear queued at at (s.mu held).
func (s *armoryScout) queuedBuilds(n int, at time.Time) {
	for range n {
		s.built = append(s.built, at)
	}
	if len(s.built) > maxScoutLanes {
		s.built = slices.Clone(s.built[len(s.built)-maxScoutLanes:])
	}
}

// lastBuild is when the scout last queued a character's gear (zero since the server started).
func (s *armoryScout) lastBuild() time.Time {
	if len(s.built) == 0 {
		return time.Time{}
	}
	return s.built[len(s.built)-1]
}

// try says whether key was not tried lately, and remembers it as tried for ttl (s.mu held). Past
// scoutTried keys, the ones whose time is over are forgotten, then the oldest.
func (s *armoryScout) try(key string, ttl time.Duration) bool {
	at := time.Now()
	if until, ok := s.tried[key]; ok && until.After(at) {
		return false
	}
	if len(s.tried) >= scoutTried {
		for k, until := range s.tried {
			if !until.After(at) {
				delete(s.tried, k)
			}
		}
		for k := range s.tried {
			if len(s.tried) < scoutTried {
				break
			}
			delete(s.tried, k)
		}
	}
	s.tried[key] = at.Add(ttl)
	return true
}

// enqueue adds the party and force members the Windows app of account by sent to the names the
// scout searches for, and says how many it took: none it tried lately or waits for already. One
// account has at most scoutNamesBy names waiting, so its app cannot crowd the others' out; past
// that, and when scoutNames wait, its newest names take the place of the oldest.
func (s *armoryScout) enqueue(by string, names []scoutName) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	at, taken := time.Now(), 0
	for _, n := range names {
		n.by = by
		if until, ok := s.tried[n.key()]; ok && until.After(at) || slices.ContainsFunc(s.names, func(w scoutName) bool { return w.key() == n.key() }) {
			continue
		}
		mine := 0
		for _, w := range s.names {
			if w.by == by {
				mine++
			}
		}
		if mine >= scoutNamesBy {
			oldest := slices.IndexFunc(s.names, func(w scoutName) bool { return w.by == by })
			s.names = slices.Delete(s.names, oldest, oldest+1)
		} else if len(s.names) >= scoutNames {
			s.names = s.names[1:]
		}
		s.names = append(s.names, n)
		taken++
	}
	return taken
}

// scoutArmory is the odyle-armory-scout job: unless the armory is paused or PLAYNC refused the
// server, up to scoutSteps pages.
func scoutArmory(app core.App) (result, error) {
	out := result{}
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

// unblock lets the armory's queue and the scout ask PLAYNC again at once (Server controls:
// the armory resumed after a pause).
func (w *armoryWork) unblock() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.blocked = time.Time{}
	w.nudge()
}

// refuse stops the armory's queue (and the scout) for as long as PLAYNC asked, and at least
// armoryBlocked.
func (w *armoryWork) refuse(r armoryRefused) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.blocked = later(w.blocked, time.Now().Add(max(r.wait, armoryBlocked)))
}

// step queues top characters' gear when it is time to, then asks PLAYNC for one page, and says
// whether it asked.
func (s *armoryScout) step(app core.App) (bool, error) {
	if err := s.build(app); err != nil {
		return false, err
	}
	if hit, ok := s.next(); ok {
		return true, checkRank(app, hit)
	}
	if hit, ok, err := s.nextOwn(app); err != nil {
		return false, err
	} else if ok {
		return true, checkRank(app, hit)
	}
	// Readers' searches first: the scout searches only in a slot of their spacing.
	if err := stateOf(app).armorySearch.slot(); err != nil {
		return false, nil
	}
	if n, ok, err := s.nextName(app); err != nil {
		return false, err
	} else if ok {
		return s.find(app, n)
	}
	return s.search(app)
}

// build queues the gear of the strongest top characters whose gear is unknown or old, as many as
// the scout's lanes (Server controls) may read now: each lane one every scoutBuildGap at most, so
// they run at once; none while it has none.
func (s *armoryScout) build(app core.App) error {
	lanes := int(readSettings(app).ScoutLanes)
	s.mu.Lock()
	due := s.buildsDue(lanes, time.Now())
	s.mu.Unlock()
	if due == 0 {
		return nil
	}
	hits, err := nextBuilds(app)
	if err != nil || len(hits) == 0 {
		return err
	}
	if n := stateOf(app).armory.scout(app, hits, due); n > 0 {
		s.mu.Lock()
		s.queuedBuilds(n, time.Now())
		s.mu.Unlock()
	}
	return nil
}

// nextOwn is a character an Odyle account plays, of the highest level the searches met, whose
// combat power the armory has not checked for rankKeep: the portrait lookup learned its PLAYNC id
// (portraits.go), so its info page is read without a search. One the scout checked is passed over
// for scoutOwnRetry, so one PLAYNC no longer lists, or that failed, waits a day.
func (s *armoryScout) nextOwn(app core.App) (scoutHit, bool, error) {
	s.mu.Lock()
	level := s.level
	s.mu.Unlock()
	if level == 0 {
		return scoutHit{}, false, nil
	}
	rows := []struct {
		Region   string `db:"officialRegion"`
		ServerId int    `db:"officialServerId"`
		Id       string `db:"officialId"`
	}{}
	if err := app.DB().NewQuery("SELECT officialRegion, officialServerId, officialId FROM characters c WHERE officialId != '' AND officialId != '-' AND officialRegion != '' AND level >= {:level}" +
		" AND NOT EXISTS (SELECT 1 FROM armory_ranks r WHERE r.serverId = c.officialServerId AND r.characterId = c.officialId AND (r.checkedAt >= {:recent} OR r.hidden = TRUE))" +
		" AND NOT EXISTS (SELECT 1 FROM armory_profiles p WHERE p.serverId = c.officialServerId AND p.characterId = c.officialId AND p.hidden = TRUE) ORDER BY RANDOM() LIMIT {:picks}").
		Bind(dbx.Params{"level": level, "recent": ago(rankKeep), "picks": scoutPicks}).All(&rows); err != nil {
		return scoutHit{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range rows {
		if armoryIds.MatchString(r.Id) && s.try("own|"+strconv.Itoa(r.ServerId)+"|"+r.Id, scoutOwnRetry) {
			return scoutHit{region: r.Region, serverId: r.ServerId, characterId: r.Id}, true, nil
		}
	}
	return scoutHit{}, false, nil
}

// pendingOwn counts the characters Odyle's accounts play that nextOwn would check, tried or not.
func pendingOwn(app core.App, level int64) int {
	if level == 0 {
		return 0
	}
	var n int
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM characters c WHERE officialId != '' AND officialId != '-' AND officialRegion != '' AND level >= {:level}" +
		" AND NOT EXISTS (SELECT 1 FROM armory_ranks r WHERE r.serverId = c.officialServerId AND r.characterId = c.officialId AND (r.checkedAt >= {:recent} OR r.hidden = TRUE))" +
		" AND NOT EXISTS (SELECT 1 FROM armory_profiles p WHERE p.serverId = c.officialServerId AND p.characterId = c.officialId AND p.hidden = TRUE)").
		Bind(dbx.Params{"level": level, "recent": ago(rankKeep)}).Row(&n)
	return n
}

// nextName is the next player to search for by name: a party or force member a Windows app sent,
// else a player of the PvP events of the last rankKeep (whom a character killed, helped kill or
// was killed by, or whose kill it helped), picked at random among those with a server. A name the
// armory checked lately on that server, or one the scout searched for lately, is passed over; a
// name is searched for once in rankKeep.
func (s *armoryScout) nextName(app core.App) (scoutName, bool, error) {
	s.mu.Lock()
	for len(s.names) > 0 {
		n := s.names[0]
		s.names = s.names[1:]
		if s.try(n.key(), rankKeep) {
			s.mu.Unlock()
			return n, true, nil
		}
	}
	level := s.level
	s.mu.Unlock()
	if level == 0 {
		return scoutName{}, false, nil
	}
	met := []struct {
		Name   string `db:"name"`
		Server string `db:"server"`
		Region string `db:"region"`
	}{}
	if err := app.DB().NewQuery("SELECT name, server, region FROM (SELECT name, server, region FROM character_pvp WHERE at >= {:since} AND server != '' AND region != ''" +
		" UNION SELECT killer, killerServer, killerRegion FROM character_pvp WHERE at >= {:since} AND killer != '' AND killerServer != '' AND killerRegion != '') ORDER BY RANDOM() LIMIT {:picks}").
		Bind(dbx.Params{"since": ago(rankKeep), "picks": scoutPicks}).All(&met); err != nil || len(met) == 0 {
		return scoutName{}, false, err
	}
	// The names the armory checked lately, on which servers.
	lower := make([]any, len(met))
	for i, m := range met {
		lower[i] = strings.ToLower(m.Name)
	}
	type knownName struct {
		Name     string `db:"name"`
		ServerId int    `db:"serverId"`
	}
	known := []knownName{}
	if err := app.DB().Select("LOWER(name) AS name", "serverId").From("armory_ranks").Where(dbx.In("LOWER(name)", lower...)).
		AndWhere(dbx.NewExp("checkedAt >= {:recent} OR hidden = TRUE", dbx.Params{"recent": ago(rankKeep)})).All(&known); err != nil {
		return scoutName{}, false, err
	}
	book := serversOf(app)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range met {
		n := scoutName{name: m.Name, server: m.Server, region: m.Region}
		if slices.ContainsFunc(known, func(k knownName) bool { return k.Name == strings.ToLower(m.Name) && book.name(k.ServerId) == m.Server }) {
			continue
		}
		if s.try(n.key(), rankKeep) {
			return n, true, nil
		}
	}
	return scoutName{}, false, nil
}

// find searches for a player by name on their server, as the portrait lookup does (findOfficial),
// and has the character it lists checked next when it is of the highest level the searches met.
// It says whether it asked PLAYNC.
func (s *armoryScout) find(app core.App, n scoutName) (bool, error) {
	book := serversOf(app)
	if len(book.searches(n.server, n.region)) == 0 {
		return false, nil
	}
	hit, err := findOfficial(book, n.name, n.server, n.region)
	if err != nil {
		return true, err
	}
	class := gameClasses(app)[hit.classId].Name
	s.mu.Lock()
	defer s.mu.Unlock()
	if !armoryIds.MatchString(hit.id) || hit.level < s.level {
		return true, nil
	}
	s.hits = append([]scoutHit{{region: hit.region, serverId: hit.serverId, characterId: hit.id, name: n.name, class: class}}, s.hits...)
	if len(s.hits) > scoutHits {
		s.hits = s.hits[:scoutHits]
	}
	return true, nil
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

// pendingBuilds are the characters whose gear the scout reads next: those in their class's top
// rankLimit (topRows) whose gear is unknown or older than old, the strongest first.
func pendingBuilds(app core.App, old string) ([]topRow, error) {
	rows, err := topRows(app)
	if err != nil {
		return nil, err
	}
	pending := rows[:0]
	for _, r := range rows {
		if r.BuiltAt == "" || r.BuiltAt < old {
			pending = append(pending, r)
		}
	}
	return pending, nil
}

// The characters below the top whose gear the scout reads for the Upgrade tab's next step
// (upgrades.go): in bands of combat power peerBand wide, up to peerPerBand of each band read in
// the last peerRebuild. A build below the top is read again after peerRebuild, before cleanRanks
// forgets its row rankKeep after it was read.
const (
	peerBand    = 1.1
	peerPerBand = 12
	peerRebuild = 25 * 24 * time.Hour
)

// peerBandOf is the band of a combat power below the top: its logarithm in peerBand, rounded down.
func peerBandOf(power int64) int {
	return int(math.Floor(math.Log(float64(max(power, 1))) / math.Log(peerBand)))
}

// pendingPeers are the characters below their class's top whose gear the scout reads once no top
// character's is due: of the highest level the armory knows of the class, in the bands of combat
// power with fewer than peerPerBand builds read in the last peerRebuild, those whose gear is
// unknown or older; the band with the fewest first, the strongest of a band first. The builds
// readers' lookups keep count for their bands too.
func pendingPeers(app core.App) ([]topRow, error) {
	classes := []string{}
	if err := app.DB().NewQuery(rankedClasses).Column(&classes); err != nil {
		return nil, err
	}
	type peer struct {
		row        topRow
		band, have int
	}
	recent := ago(peerRebuild)
	peers := []peer{}
	for _, class := range classes {
		rows := []struct {
			topRow
			Level int64 `db:"level"`
		}{}
		if err := app.DB().NewQuery("SELECT id, combatPower, builtAt, level FROM armory_ranks WHERE class = {:class} AND hidden = FALSE ORDER BY combatPower DESC, id").
			Bind(dbx.Params{"class": class}).All(&rows); err != nil {
			return nil, err
		}
		if len(rows) <= rankLimit {
			continue
		}
		var levelCap int64
		for _, r := range rows {
			levelCap = max(levelCap, r.Level)
		}
		have, waiting := map[int]int{}, []peer{}
		for _, r := range rows[rankLimit:] {
			if r.Level != levelCap || r.CombatPower <= 0 {
				continue
			}
			band := peerBandOf(r.CombatPower)
			if r.BuiltAt != "" && r.BuiltAt >= recent {
				have[band]++
			} else {
				waiting = append(waiting, peer{row: r.topRow, band: band})
			}
		}
		for _, p := range waiting {
			if have[p.band] < peerPerBand {
				p.have = have[p.band]
				peers = append(peers, p)
			}
		}
	}
	slices.SortStableFunc(peers, func(a, b peer) int { return cmp.Or(a.have-b.have, cmp.Compare(b.row.CombatPower, a.row.CombatPower)) })
	out := make([]topRow, len(peers))
	for i, p := range peers {
		out[i] = p.row
	}
	return out, nil
}

// nextBuilds are the strongest characters in their class's top whose gear is unknown or old, then
// those below the top it reads the gear of (pendingPeers), up to scoutPicks: the armory's queue
// takes the first it may (armoryWork.scout), passing over those whose gear it reads already or
// whose lookup failed lately.
func nextBuilds(app core.App) ([]scoutHit, error) {
	pending, err := pendingBuilds(app, ago(scoutRebuild))
	if err != nil {
		return nil, err
	}
	if len(pending) < scoutPicks {
		peers, err := pendingPeers(app)
		if err != nil {
			return nil, err
		}
		pending = append(pending, peers...)
	}
	pending = pending[:min(len(pending), scoutPicks)]
	rows := []struct {
		Id          string `db:"id"`
		Region      string `db:"region"`
		ServerId    int    `db:"serverId"`
		CharacterId string `db:"characterId"`
	}{}
	if err := app.DB().Select("id", "region", "serverId", "characterId").From("armory_ranks").Where(dbx.In("id", topIds(pending)...)).All(&rows); err != nil {
		return nil, err
	}
	byId := make(map[string]scoutHit, len(rows))
	for _, r := range rows {
		byId[r.Id] = scoutHit{region: r.Region, serverId: r.ServerId, characterId: r.CharacterId}
	}
	hits := []scoutHit{}
	for _, p := range pending {
		if hit, ok := byId[p.Id]; ok {
			hits = append(hits, hit)
		}
	}
	return hits, nil
}

// scoutShown is how many characters of each of the scout's lists the Server status page names.
const scoutShown = 20

// scoutPending is a character the scout still reads, on the Server status page.
type scoutPending struct {
	Region      string `db:"region" json:"region"`
	ServerId    int    `db:"serverId" json:"serverId"`
	Server      string `db:"-" json:"server"`
	CharacterId string `db:"characterId" json:"characterId"`
	Name        string `db:"name" json:"name"`
	Class       string `db:"class" json:"class"`
	CombatPower int64  `db:"combatPower" json:"combatPower"`
	BuiltAt     string `db:"builtAt" json:"builtAt"`
	Id          string `db:"id" json:"-"`
}

// scoutStatus is the scout's part of the Server status page: what it still reads of PLAYNC.
// builds counts the top players whose gear it reads (neverBuilt of them never read, the others
// scoutRebuild old) and buildQueue names the first scoutShown in the order it reads them; peers
// counts the characters below the top whose gear it reads next (pendingPeers); checks
// counts the characters its search pages and name searches found whose combat power it reads next
// (in server memory, so a restart forgets them) and checkQueue names the first scoutShown, as far
// as the armory knows them. own counts the characters Odyle's accounts play it checks next, names
// the party and force members Windows apps sent that it searches for (in server memory too), and
// nameQueue names the first scoutShown. level is the highest level its searches met (it keeps
// only characters of it), buildEvery how often it queues a character's gear on average (in
// seconds, 0 with no scout lanes; each lane one every scoutBuildGap, only while no reader's lookup
// waits) and lastBuildAt when it last did.
func scoutStatus(app core.App) map[string]any {
	s := stateOf(app).scout
	s.mu.Lock()
	hits := slices.Clone(s.hits[:min(len(s.hits), scoutShown)])
	waiting := slices.Clone(s.names[:min(len(s.names), scoutShown)])
	checks, names, level, builtAt := len(s.hits), len(s.names), s.level, s.lastBuild()
	s.mu.Unlock()
	book := serversOf(app)
	builds := []scoutPending{}
	pending, _ := pendingBuilds(app, ago(scoutRebuild))
	total, never := len(pending), 0
	for _, p := range pending {
		if p.BuiltAt == "" {
			never++
		}
	}
	shown := pending[:min(len(pending), scoutShown)]
	_ = app.DB().Select("id", "region", "serverId", "characterId", "name", "class", "combatPower", "builtAt").From("armory_ranks").Where(dbx.In("id", topIds(shown)...)).All(&builds)
	slices.SortFunc(builds, func(a, b scoutPending) int {
		at := func(id string) int { return slices.IndexFunc(shown, func(p topRow) bool { return p.Id == id }) }
		return at(a.Id) - at(b.Id)
	})
	for i := range builds {
		b := &builds[i]
		b.Server = book.inRegion(b.Region, b.ServerId)
		if at, err := time.Parse(stampLayout, b.BuiltAt); err == nil {
			b.BuiltAt = isoTime(at)
		}
	}
	queue := make([]scoutPending, len(hits))
	for i, h := range hits {
		q := &queue[i]
		q.Region, q.ServerId, q.Server, q.CharacterId = h.region, h.serverId, book.inRegion(h.region, h.serverId), h.characterId
		q.Name, q.Class = h.name, h.class
		// A character checked more than rankKeep ago may still be kept, with its combat power.
		var name, class string
		if err := app.DB().NewQuery("SELECT name, class, combatPower FROM armory_ranks WHERE serverId = {:server} AND characterId = {:id}").
			Bind(dbx.Params{"server": h.serverId, "id": h.characterId}).Row(&name, &class, &q.CombatPower); err == nil {
			q.Name, q.Class = cmp.Or(q.Name, name), cmp.Or(q.Class, class)
		}
	}
	every := 0
	if lanes := readSettings(app).ScoutLanes; lanes > 0 {
		every = int((scoutBuildGap / time.Duration(lanes)).Seconds())
	}
	nameQueue := make([]map[string]any, len(waiting))
	for i, n := range waiting {
		nameQueue[i] = map[string]any{"name": n.name, "server": n.server, "region": n.region}
	}
	peers, _ := pendingPeers(app)
	return map[string]any{"builds": total, "neverBuilt": never, "buildQueue": builds, "peers": len(peers), "checks": checks, "checkQueue": queue,
		"own": pendingOwn(app, level), "names": names, "nameQueue": nameQueue, "level": level, "buildEvery": every, "lastBuildAt": isoTime(builtAt)}
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
	p, err := readArmory(info, nil)
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
	region := regionOfDigit(digit).code
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
		// The search marks the letter in the name (<strong>a</strong>).
		hits = append(hits, scoutHit{region: region, serverId: server.Id, characterId: id, name: jsonText(h, "name", 100), class: class})
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
