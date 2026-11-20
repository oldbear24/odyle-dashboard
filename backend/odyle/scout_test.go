package odyle

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
)

// fastScout shortens the scout's steps and has it pick the first server, class, letter and page.
func fastScout(t *testing.T) {
	step, pick := scoutStep, scoutPick
	scoutStep, scoutPick = time.Millisecond, func(int) int { return 0 }
	t.Cleanup(func() { scoutStep, scoutPick = step, pick })
}

// The scout searches PLAYNC for characters of the highest level, reads the combat power of each
// it has not checked lately, then the gear of the strongest of a class's top, and asks for one
// page a step; paused with the armory, it asks for nothing.
func TestScoutFindsTheStrongestOfEachClass(t *testing.T) {
	fastArmory(t)
	fastScout(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	scout := stateOf(app).scout
	// A search page: of its three characters, the one of the highest level waits to be checked.
	if asked, err := scout.step(app); err != nil || !asked || stand.searches.Load() != 1 || len(scout.hits) != 1 || scout.hits[0].characterId != id || scout.level != 45 {
		t.Fatalf("search: %v %v, %d searches, hits %+v, level %d", asked, err, stand.searches.Load(), scout.hits, scout.level)
	}
	// Server status names it among the characters whose combat power the scout reads next, by the
	// name and class the search page listed it with.
	if st := scoutStatus(app); st["checks"] != 1 || st["checkQueue"].([]scoutPending)[0].CharacterId != id || st["checkQueue"].([]scoutPending)[0].Server == "" ||
		st["checkQueue"].([]scoutPending)[0].Name != "a" || st["checkQueue"].([]scoutPending)[0].Class == "" ||
		st["level"] != int64(45) || st["builds"] != 0 || len(st["buildQueue"].([]scoutPending)) != 0 || st["lastBuildAt"] != "" {
		t.Fatalf("status after the search %+v", st)
	}
	// Its info page: its combat power, without its gear.
	if asked, err := scout.step(app); err != nil || !asked || stand.lookups.Load() != 1 || stand.details.Load() != 0 {
		t.Fatalf("check: %v %v, %d info pages, %d others", asked, err, stand.lookups.Load(), stand.details.Load())
	}
	row, ok := rankAt(t, app, id)
	if !ok || row.Name != "Hero" || row.Class != "Chanter" || row.CombatPower != 107458 || row.BuiltAt != "" || row.Build != "null" && row.Build != "" {
		t.Fatalf("checked %+v", row)
	}
	// Then among the top players whose gear it reads, never read yet, one every 3 minutes.
	if st := scoutStatus(app); st["checks"] != 0 || st["builds"] != 1 || st["neverBuilt"] != 1 || st["buildEvery"] != 180 {
		t.Fatalf("status after the check %+v", st)
	} else if q := st["buildQueue"].([]scoutPending); len(q) != 1 || q[0].Name != "Hero" || q[0].Class != "Chanter" || q[0].CombatPower != 107458 || q[0].Server == "" || q[0].BuiltAt != "" {
		t.Fatalf("gear to read %+v", q)
	}
	// It is in its class's top: the armory's queue reads its gear (info, equipment and the item
	// pages, no board), with the icons and no portrait; the step searches on meanwhile, and the
	// character it finds again was checked lately.
	if asked, err := scout.step(app); err != nil || !asked || stand.searches.Load() != 2 || len(scout.hits) != 0 {
		t.Fatalf("build: %v %v, %d searches, hits %+v", asked, err, stand.searches.Load(), scout.hits)
	}
	stateOf(app).armory.wait()
	if stand.lookups.Load() != 2 || stand.details.Load() != 3 {
		t.Fatalf("build: %d info pages, %d others", stand.lookups.Load(), stand.details.Load())
	}
	row, _ = rankAt(t, app, id)
	var build armoryProfile
	if err := json.Unmarshal([]byte(row.Build), &build); err != nil || row.BuiltAt == "" || row.Portrait != "" || len(build.Gear) != 4 || build.Gear[0].Detail == nil || build.Gear[0].Detail.ItemLevel != 102 ||
		!strings.HasPrefix(build.Gear[0].Icon, "Icon_") || len(build.Boards[0].Nodes) != 0 {
		t.Fatalf("built %+v", row)
	}
	if countOf(t, app, "armory_profiles") != 0 {
		t.Fatal("the scout keeps profiles")
	}
	// Its gear read, nothing waits; read 14 days ago, it waits again.
	if st := scoutStatus(app); st["builds"] != 0 || len(st["buildQueue"].([]scoutPending)) != 0 || st["lastBuildAt"] == "" {
		t.Fatalf("status after the build %+v", st)
	}
	if _, err := app.DB().NewQuery("UPDATE armory_ranks SET builtAt = {:old}").Bind(dbx.Params{"old": ago(scoutRebuild + time.Hour)}).Execute(); err != nil {
		t.Fatal(err)
	}
	if st := scoutStatus(app); st["builds"] != 1 || st["neverBuilt"] != 0 || !strings.HasSuffix(st["buildQueue"].([]scoutPending)[0].BuiltAt, "Z") {
		t.Fatalf("status with old gear %+v", st)
	}
	// The job: up to five pages a run; paused with the armory.
	out, err := scoutArmory(app)
	if err != nil || out.Done != scoutSteps || out.Failed != 0 || stand.searches.Load() != 2+scoutSteps || stand.lookups.Load() != 2 {
		t.Fatalf("run %+v (%v), %d searches", out, err, stand.searches.Load())
	}
	if _, err := writeSettings(app, body{"armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	if out, err := scoutArmory(app); err != nil || out.Skipped != "paused" || stand.searches.Load() != 2+scoutSteps {
		t.Fatalf("paused %+v (%v)", out, err)
	}
	// No lanes for the scout (Server controls): it reads no gear.
	if _, err := writeSettings(app, body{"armoryPaused": false, "scoutLanes": 0.0}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB().NewQuery("UPDATE armory_ranks SET builtAt = ''").Execute(); err != nil {
		t.Fatal(err)
	}
	scout.built = nil
	if _, err := scout.step(app); err != nil || armoryStatus(app)["waiting"] != 0 || armoryStatus(app)["running"] != 0 {
		t.Fatalf("with no lanes: %v %v", err, armoryStatus(app))
	}
}

// Each of the scout's lanes reads a character's gear every 3 minutes at most, so with two lanes
// the gear of the two strongest characters it lacks is read at once. A character whose gear is
// read already, or whose lookup failed lately, is passed over for the next.
func TestScoutReadsGearInAllItsLanes(t *testing.T) {
	fastArmory(t)
	fastScout(t)
	stand := &armoryStand{gate: make(chan struct{})}
	stand.serve(t)
	release := sync.OnceFunc(func() { close(stand.gate) })
	t.Cleanup(release) // before the stand closes, which waits for the answers it holds
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"scoutLanes": 2.0}); err != nil {
		t.Fatal(err)
	}
	for i, power := range []int64{900000, 800000, 700000, 600000} {
		rankOf(t, app, i+1, "Chanter", power, false, nil)
	}
	idOf := func(n int) string { return fmt.Sprintf("AAAAAAAAAAAAAAAAAAAAA%03d", n) }
	scout, work := stateOf(app).scout, stateOf(app).armory
	running := func(n int) {
		t.Helper()
		for i := 0; i < 200 && armoryStatus(app)["running"] != n; i++ {
			time.Sleep(5 * time.Millisecond)
		}
		if got := armoryStatus(app)["running"]; got != n {
			t.Fatalf("%v running, want %d", got, n)
		}
	}
	// The two strongest at once.
	if err := scout.build(app); err != nil {
		t.Fatal(err)
	}
	running(2)
	queue := armoryStatus(app)["queue"].([]map[string]any)
	if ids := []any{queue[0]["characterId"], queue[1]["characterId"]}; queue[0]["scout"] != true || queue[1]["scout"] != true ||
		!(ids[0] == idOf(1) && ids[1] == idOf(2) || ids[0] == idOf(2) && ids[1] == idOf(1)) {
		t.Fatalf("queue %v", queue)
	}
	// Both lanes read one in these 3 minutes: nothing more now. 3 minutes on, the lanes are still
	// busy, and the two being read are not queued again.
	if err := scout.build(app); err != nil || armoryStatus(app)["waiting"] != 0 {
		t.Fatalf("again: %v, %v waiting", err, armoryStatus(app)["waiting"])
	}
	scout.built = []time.Time{time.Now().Add(-scoutBuildGap), time.Now().Add(-scoutBuildGap)}
	if err := scout.build(app); err != nil || armoryStatus(app)["waiting"] != 0 || armoryStatus(app)["running"] != 2 {
		t.Fatalf("lanes busy: %v, %v", err, armoryStatus(app))
	}
	release()
	work.wait()
	for _, n := range []int{1, 2} {
		if row, ok := rankAt(t, app, idOf(n)); !ok || row.BuiltAt == "" {
			t.Fatalf("the gear of %d: %+v", n, row)
		}
	}
	// The third's lookup failed a moment ago: the fourth is read in its place, alone.
	work.mu.Lock()
	work.misses[scoutKey(2304, idOf(3))] = armoryMiss{until: time.Now().Add(armoryRetry), error: "PLAYNC answered 500."}
	work.mu.Unlock()
	scout.built = nil
	if err := scout.build(app); err != nil {
		t.Fatal(err)
	}
	work.wait()
	if row, _ := rankAt(t, app, idOf(3)); row.BuiltAt != "" {
		t.Fatalf("the failed one was read again: %+v", row)
	}
	if row, _ := rankAt(t, app, idOf(4)); row.BuiltAt == "" || len(scout.built) != 1 {
		t.Fatalf("the fourth: %+v, %d queued", row, len(scout.built))
	}
}

// While a reader's lookup waits, the scout reads no character's gear; PLAYNC refusing the server
// stops it with the armory's queue.
func TestScoutLeavesPLAYNCToReaders(t *testing.T) {
	fastArmory(t)
	fastScout(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	rankOf(t, app, 1, "Chanter", 900000, false, nil)
	w := stateOf(app).armory
	w.mu.Lock()
	w.waiting = append(w.waiting, armoryJob{key: "2304/reader", region: "eu", serverId: 2304, characterId: "reader", address: "10.0.0.1"})
	w.mu.Unlock()
	if _, err := stateOf(app).scout.step(app); err != nil || stand.lookups.Load() != 0 || stand.searches.Load() != 1 || armoryStatus(app)["waiting"] != 1 {
		t.Fatalf("with a reader waiting: %v, %d info pages, %d searches", err, stand.lookups.Load(), stand.searches.Load())
	}
	w.mu.Lock()
	w.waiting = nil
	w.mu.Unlock()
	w.refuse(armoryRefused{wait: time.Hour})
	if out, err := scoutArmory(app); err != nil || out.Skipped != "paused" || stand.searches.Load() != 1 {
		t.Fatalf("refused %+v (%v)", out, err)
	}
}

// Before its searches, the scout checks the characters Odyle's accounts play (their PLAYNC ids
// known, so without a search) and searches for the players Odyle met by name: the party and force
// members Windows apps sent first, then the players of the PvP events kept. Each is tried once,
// and only characters of the highest level met are checked.
func TestScoutChecksOdyleCharactersAndThePlayersTheyMet(t *testing.T) {
	fastArmory(t)
	fastScout(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true, "scoutLanes": 0.0}); err != nil {
		t.Fatal(err)
	}
	const own, found = "ownAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	player := newUser(t, app, "Fighter")
	c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Hero", "server": "Lumiel", "region": "GLOBAL_EU", "officialId": own, "officialRegion": "eu", "officialServerId": 2304, "level": 45})
	saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Alt", "server": "Lumiel", "region": "GLOBAL_EU", "officialId": "altAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "officialRegion": "eu", "officialServerId": 2304, "level": 12})
	saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Shy", "server": "Lumiel", "region": "GLOBAL_EU", "officialId": "shyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "officialRegion": "eu", "officialServerId": 2304, "level": 45})
	saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": "shyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "name": "Shy", "hidden": true})
	// Players met in PvP: one with a server, one without (passed over) and the killer of an assist.
	for i, ev := range []map[string]any{{"kind": "kill", "name": "Foe", "server": "Lumiel", "region": "GLOBAL_EU"}, {"kind": "death", "name": "Ghost"}, {"kind": "assist", "name": "Prey", "killer": "Ally", "killerServer": "Lumiel", "killerRegion": "GLOBAL_EU"}} {
		ev["character"], ev["event"], ev["at"] = c.Id, strings.Repeat("0", 31)+string(rune('a'+i)), stamp(time.Now())
		saved(t, app, "character_pvp", ev)
	}
	scout := stateOf(app).scout
	// Before its first search, it checks nobody it did not find itself.
	if asked, err := scout.step(app); err != nil || !asked || stand.searches.Load() != 1 || stand.lookups.Load() != 0 || len(scout.hits) != 1 || scout.level != 45 {
		t.Fatalf("first step: %v %v, %d searches, %d info pages", asked, err, stand.searches.Load(), stand.lookups.Load())
	}
	scout.hits = nil
	// A party member waits to be searched for, once, whatever the case of the name.
	if n := scout.enqueue("account", []scoutName{{"Mate", "Lumiel", "GLOBAL_EU", ""}, {"mate", "Lumiel", "GLOBAL_EU", ""}, {"Mate", "Lumiel", "GLOBAL_EU", ""}}); n != 1 {
		t.Fatalf("queued %d", n)
	}
	if st := scoutStatus(app); st["own"] != 1 || st["names"] != 1 || st["nameQueue"].([]map[string]any)[0]["name"] != "Mate" {
		t.Fatalf("status %+v", st)
	}
	// The character an account plays, of the highest level: its info page, without a search; the
	// lower one and the hidden one are passed over.
	if asked, err := scout.step(app); err != nil || !asked || stand.searches.Load() != 1 || stand.lookups.Load() != 1 {
		t.Fatalf("own: %v %v, %d searches, %d info pages", asked, err, stand.searches.Load(), stand.lookups.Load())
	}
	if row, ok := rankAt(t, app, own); !ok || row.Name != "Hero" {
		t.Fatalf("own row %+v", row)
	}
	// Then the party member: a search for the name on the character's server, and the character
	// it lists is checked next.
	if asked, err := scout.step(app); err != nil || !asked || stand.searches.Load() != 2 || len(scout.hits) != 1 || scout.hits[0] != (scoutHit{region: "eu", serverId: 2304, characterId: found, name: "Mate", class: "Chanter"}) {
		t.Fatalf("party member: %v %v, %d searches, hits %+v", asked, err, stand.searches.Load(), scout.hits)
	}
	if asked, err := scout.step(app); err != nil || !asked || stand.lookups.Load() != 2 {
		t.Fatalf("found: %v %v, %d info pages", asked, err, stand.lookups.Load())
	}
	if n := scout.enqueue("account", []scoutName{{"Mate", "Lumiel", "GLOBAL_EU", ""}}); n != 0 {
		t.Fatal("a name searched for lately was queued again")
	}
	// Then the players met in PvP, each once: two searches, two checks, then the searches go on.
	for i := 0; i < 4; i++ {
		if _, err := scout.step(app); err != nil {
			t.Fatal(err)
		}
	}
	if stand.searches.Load() != 4 || stand.lookups.Load() != 4 {
		t.Fatalf("PvP players: %d searches, %d info pages", stand.searches.Load(), stand.lookups.Load())
	}
	if _, err := scout.step(app); err != nil || stand.searches.Load() != 5 || len(scout.hits) != 1 || scout.hits[0].region != "nae" || len(scout.names) != 0 {
		t.Fatalf("searching on: %v, %d searches, hits %+v", err, stand.searches.Load(), scout.hits)
	}
	scout.hits = nil
	if st := scoutStatus(app); st["own"] != 0 {
		t.Fatalf("status after %+v", st)
	}
	// The hidden character's row stays hidden when the scout checks it some other way.
	if err := checkRank(app, scoutHit{region: "eu", serverId: 2304, characterId: "shyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}); err != nil {
		t.Fatal(err)
	}
	var hidden bool
	if err := app.DB().NewQuery("SELECT hidden FROM armory_ranks WHERE characterId = 'shyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='").Row(&hidden); err != nil || !hidden {
		t.Fatalf("hidden %v (%v)", hidden, err)
	}
	// PLAYNC refusing a name search stops the scout with the armory's queue.
	scout.enqueue("account", []scoutName{{"Refused", "Lumiel", "GLOBAL_EU", ""}})
	var refused armoryRefused
	if _, err := scout.step(app); !errors.As(err, &refused) {
		t.Fatalf("refused: %v", err)
	}
}

// One account's app cannot crowd the others' names out of the scout's queue: past its share, its
// newest names take the place of its oldest, and a full queue drops its oldest name.
func TestScoutQueueSharesBetweenAccounts(t *testing.T) {
	scout := newArmoryScout()
	names := func(prefix string, n int) []scoutName {
		out := make([]scoutName, n)
		for i := range out {
			out[i] = scoutName{name: fmt.Sprintf("%s%d", prefix, i), server: "Lumiel", region: "GLOBAL_EU"}
		}
		return out
	}
	scout.enqueue("other", names("Friend", 3))
	if n := scout.enqueue("flood", names("Junk", scoutNamesBy+50)); n != scoutNamesBy+50 {
		t.Fatalf("queued %d", n)
	}
	flood := 0
	for _, w := range scout.names {
		if w.by == "flood" {
			flood++
		}
	}
	if flood != scoutNamesBy || len(scout.names) != scoutNamesBy+3 || scout.names[0].name != "Friend0" || scout.names[len(scout.names)-1].name != fmt.Sprintf("Junk%d", scoutNamesBy+49) {
		t.Fatalf("%d of the flood's names wait, %d in all, first %q", flood, len(scout.names), scout.names[0].name)
	}
	for i := 0; len(scout.names) < scoutNames; i++ {
		scout.enqueue(fmt.Sprintf("account%d", i), names(fmt.Sprintf("Player%d-", i), scoutNamesBy))
	}
	second := scout.names[1]
	scout.enqueue("late", names("Late", 1))
	if len(scout.names) != scoutNames || scout.names[0] != second || scout.names[len(scout.names)-1].name != "Late0" {
		t.Fatalf("full queue: %d, first %q, last %q", len(scout.names), scout.names[0].name, scout.names[len(scout.names)-1].name)
	}
}
