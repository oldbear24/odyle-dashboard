package odyle

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
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
	// Its info page: its combat power, without its gear.
	if asked, err := scout.step(app); err != nil || !asked || stand.lookups.Load() != 1 || stand.details.Load() != 0 {
		t.Fatalf("check: %v %v, %d info pages, %d others", asked, err, stand.lookups.Load(), stand.details.Load())
	}
	row, ok := rankAt(t, app, id)
	if !ok || row.Name != "Hero" || row.Class != "Chanter" || row.CombatPower != 107458 || row.BuiltAt != "" || row.Build != "null" && row.Build != "" {
		t.Fatalf("checked %+v", row)
	}
	// It is in its class's top: its gear (info, equipment and the item page, no board), with the
	// icons and no portrait.
	if asked, err := scout.step(app); err != nil || !asked || stand.lookups.Load() != 2 || stand.details.Load() != 3 {
		t.Fatalf("build: %v %v, %d info pages, %d others", asked, err, stand.lookups.Load(), stand.details.Load())
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
	// Built lately and checked lately: the next search keeps nobody to check.
	if asked, err := scout.step(app); err != nil || !asked || stand.searches.Load() != 2 || len(scout.hits) != 0 {
		t.Fatalf("searched again: %v %v, hits %+v", asked, err, scout.hits)
	}
	// The job: up to five pages a run; paused with the armory.
	out, err := scoutArmory(app)
	if err != nil || out.Done != scoutSteps || out.Failed != 0 || stand.searches.Load() != 2+scoutSteps {
		t.Fatalf("run %+v (%v), %d searches", out, err, stand.searches.Load())
	}
	if _, err := writeSettings(app, body{"armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	if out, err := scoutArmory(app); err != nil || out.Skipped != "paused" || stand.searches.Load() != 2+scoutSteps {
		t.Fatalf("paused %+v (%v)", out, err)
	}
}

// While a reader's lookup waits or runs, the scout reads no character's gear; PLAYNC refusing the
// server stops it with the armory's queue.
func TestScoutLeavesPLAYNCToReaders(t *testing.T) {
	fastArmory(t)
	fastScout(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	rankOf(t, app, 1, "Chanter", 900000, false, nil)
	w := stateOf(app).armory
	w.mu.Lock()
	w.current = "2304/reader"
	w.mu.Unlock()
	if _, err := stateOf(app).scout.step(app); err != nil || stand.lookups.Load() != 0 || stand.searches.Load() != 1 {
		t.Fatalf("with a reader waiting: %v, %d info pages, %d searches", err, stand.lookups.Load(), stand.searches.Load())
	}
	w.mu.Lock()
	w.current = ""
	w.mu.Unlock()
	w.refuse(armoryRefused{wait: time.Hour})
	if out, err := scoutArmory(app); err != nil || out.Skipped != "paused" || stand.searches.Load() != 1 {
		t.Fatalf("refused %+v (%v)", out, err)
	}
}
