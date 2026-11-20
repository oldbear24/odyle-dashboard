package odyle

import (
	"encoding/json"
	"strings"
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
	// Server status names it among the characters whose combat power the scout reads next.
	if st := scoutStatus(app); st["checks"] != 1 || st["checkQueue"].([]scoutPending)[0].CharacterId != id || st["checkQueue"].([]scoutPending)[0].Server == "" ||
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
	scout.builtAt = time.Time{}
	if _, err := scout.step(app); err != nil || armoryStatus(app)["waiting"] != 0 || armoryStatus(app)["running"] != 0 {
		t.Fatalf("with no lanes: %v %v", err, armoryStatus(app))
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
