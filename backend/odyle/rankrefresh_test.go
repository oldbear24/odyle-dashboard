package odyle

import (
	"fmt"
	"net/http"
	"slices"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// bulkId is the PLAYNC id bulkRanks gives the nth character of a class.
func bulkId(class string, n int) string { return fmt.Sprintf("BULK%s%05d", class, n) }

// bulkRanks keeps n characters of a class at a level, the first the strongest, read at checked.
func bulkRanks(t *testing.T, app core.App, class string, n int, level int64, checked string) {
	t.Helper()
	err := app.RunInTransaction(func(tx core.App) error {
		for i := range n {
			if _, err := tx.DB().NewQuery("INSERT INTO armory_ranks (id, region, serverId, characterId, name, class, level, combatPower, checkedAt, builtAt, hidden) VALUES ({:id}, 'eu', 2304, {:cid}, 'Bulk', {:class}, {:level}, {:power}, {:checked}, '', FALSE)").
				Bind(dbx.Params{"id": fmt.Sprintf("b%s%09d", class[:4], i), "cid": bulkId(class, i), "class": class, "level": level, "power": 1000000 - i*10, "checked": checked}).Execute(); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// A top player's combat power is read again once it is three days old, before the scout's
// searches, and keeps its gear; nothing old, the scout searches.
func TestTopPlayersAreReadAgainForTheirAge(t *testing.T) {
	fastArmory(t)
	fastScout(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"scoutLanes": 0.0}); err != nil {
		t.Fatal(err)
	}
	rankOf(t, app, 1, "Chanter", 900000, true, map[string]any{"checkedAt": ago(topRecheck + time.Hour)})
	rankOf(t, app, 2, "Chanter", 800000, true, nil)
	if st := refreshStatus(app); st["rechecks"] != 1 || st["recheckDays"] != 3 || st["refresh"] != nil {
		t.Fatalf("status %+v", st)
	}
	scout := stateOf(app).scout
	if asked, err := scout.step(app); err != nil || !asked || stand.lookups.Load() != 1 || stand.details.Load() != 0 || stand.searches.Load() != 0 {
		t.Fatalf("re-read: %v %v, %d info pages, %d others, %d searches", asked, err, stand.lookups.Load(), stand.details.Load(), stand.searches.Load())
	}
	if row, _ := rankAt(t, app, "AAAAAAAAAAAAAAAAAAAAA001"); row.Name != "Hero" || row.CombatPower != 107458 || row.BuiltAt == "" || row.Build == "" {
		t.Fatalf("re-read %+v", row)
	}
	if st := refreshStatus(app); st["rechecks"] != 0 {
		t.Fatalf("status after %+v", st)
	}
	if asked, err := scout.step(app); err != nil || !asked || stand.searches.Load() != 1 || stand.lookups.Load() != 1 {
		t.Fatalf("then: %v %v, %d searches, %d info pages", asked, err, stand.searches.Load(), stand.lookups.Load())
	}
}

// A superuser's refresh has the scout read every character again, the top players first and then
// the others the strongest first, before anything else, until none read before it is left; the
// status counts what it still reads, and a superuser stops it. Both go to the audit log.
func TestARefreshReadsEveryCharacterAgain(t *testing.T) {
	fastArmory(t)
	fastScout(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	operator, user := newOperator(t, app), newUser(t, app, "Lead")
	admin := tokenOf(t, operator)
	// No gear read: the scout's lanes would read it beside the steps.
	if _, err := writeSettings(app, body{"scoutLanes": 0.0}); err != nil {
		t.Fatal(err)
	}
	const kept = rankLimit + rankMargin + 2
	bulkRanks(t, app, "Cleric", kept, 45, ago(time.Hour))
	if st := refreshStatus(app); st["rechecks"] != 0 || st["refresh"] != nil {
		t.Fatalf("status before %+v", st)
	}
	scout := stateOf(app).scout
	if _, err := scout.step(app); err != nil || stand.searches.Load() != 1 || stand.lookups.Load() != 0 {
		t.Fatalf("before: %v, %d searches, %d info pages", err, stand.searches.Load(), stand.lookups.Load())
	}
	scout.hits = nil

	const url = "/api/odyle/admin/armory-refresh"
	ask(t, app, http.MethodPost, url, nil, "", 401)
	ask(t, app, http.MethodPost, url, tokenOf(t, user), "", 403)
	out := ask(t, app, http.MethodPost, url, admin, "", 200)
	refresh, _ := out["refresh"].(map[string]any)
	if refresh == nil || refresh["by"] != refreshByHand || refresh["top"] != float64(rankLimit) || refresh["rows"] != float64(kept) || refresh["gear"] != float64(rankLimit) || refresh["done"] != false || refresh["at"] == "" {
		t.Fatalf("started %+v", out)
	}
	// The strongest first.
	if asked, err := scout.step(app); err != nil || !asked || stand.lookups.Load() != 1 || stand.searches.Load() != 1 {
		t.Fatalf("first: %v %v, %d info pages, %d searches", asked, err, stand.lookups.Load(), stand.searches.Load())
	}
	if row, _ := rankAt(t, app, bulkId("Cleric", 0)); row.Name != "Hero" {
		t.Fatalf("the strongest %+v", row)
	}
	// The top players and those just below them read, the others read before it next.
	if _, err := app.DB().NewQuery("UPDATE armory_ranks SET checkedAt = {:now} WHERE characterId != {:last}").Bind(dbx.Params{"now": ago(-time.Second), "last": bulkId("Cleric", kept-1)}).Execute(); err != nil {
		t.Fatal(err)
	}
	if st := refreshStatus(app)["refresh"].(map[string]any); st["top"] != 0 || st["rows"] != 1 {
		t.Fatalf("status with one left %+v", st)
	}
	if _, err := scout.step(app); err != nil || stand.lookups.Load() != 2 {
		t.Fatalf("the last: %v, %d info pages", err, stand.lookups.Load())
	}
	if row, _ := rankAt(t, app, bulkId("Cleric", kept-1)); row.Name != "Hero" {
		t.Fatalf("the last %+v", row)
	}
	// Done once the top players' gear is read again too (the two read, as PLAYNC's stand names
	// them, top the Chanters now); then the scout searches again.
	if st := refreshStatus(app)["refresh"].(map[string]any); st["rows"] != 0 || st["gear"] != rankLimit+2 || st["done"] != false {
		t.Fatalf("status with the gear left %+v", st)
	}
	if _, err := app.DB().NewQuery("UPDATE armory_ranks SET builtAt = {:now}").Bind(dbx.Params{"now": ago(-time.Second)}).Execute(); err != nil {
		t.Fatal(err)
	}
	if st := refreshStatus(app)["refresh"].(map[string]any); st["gear"] != 0 || st["done"] != true {
		t.Fatalf("status when done %+v", st)
	}
	if _, err := scout.step(app); err != nil || stand.searches.Load() != 2 || stand.lookups.Load() != 2 {
		t.Fatalf("after: %v, %d searches, %d info pages", err, stand.searches.Load(), stand.lookups.Load())
	}
	// Stopped, rows read before it no longer count as old.
	if out := ask(t, app, http.MethodDelete, url, admin, "", 200); out["refresh"] != nil || !readSettings(app).refreshAt.IsZero() {
		t.Fatalf("stopped %+v", out)
	}
	_, entries := auditLog(t, app, operator, "")
	kinds := []string{}
	for _, e := range entries {
		kinds = append(kinds, e["kind"].(string))
	}
	if !slices.Contains(kinds, auditRefresh) || len(kinds) < 2 || kinds[0] != auditRefresh || kinds[1] != auditRefresh {
		t.Fatalf("audited %v", kinds)
	}
}

// A character above the level cap the armory knew starts a refresh, once it knows a class's top
// of characters; another at that level starts none. A build missing details read during the
// refresh is not due again at once.
func TestAHigherLevelStartsARefresh(t *testing.T) {
	app := newTestApp(t)
	bulkRanks(t, app, "Cleric", rankLimit-1, 45, ago(time.Hour))
	up := func(id string, level int64) {
		t.Helper()
		if err := keepRank(app, "eu", 2304, id, armoryProfile{Name: "Up", Class: "Cleric", Level: level, CombatPower: 5}, false); err != nil {
			t.Fatal(err)
		}
	}
	up("UPAAAAAAAAAAAAAAAAAAAA01", 46)
	if !readSettings(app).refreshAt.IsZero() {
		t.Fatal("a refresh before the armory knew a top")
	}
	up("UPAAAAAAAAAAAAAAAAAAAA02", 47)
	started := readSettings(app)
	if started.refreshAt.IsZero() || started.refreshWhy != "level:47" {
		t.Fatalf("refresh %v %q", started.refreshAt, started.refreshWhy)
	}
	up("UPAAAAAAAAAAAAAAAAAAAA03", 47)
	if again := readSettings(app); !again.refreshAt.Equal(started.refreshAt) {
		t.Fatalf("started again at %v", again.refreshAt)
	}
	if st := refreshStatus(app)["refresh"].(map[string]any); st["by"] != "level" || st["level"] != 47 {
		t.Fatalf("status %+v", st)
	}
	p := armoryProfile{Name: "Gap", Class: "Templar", Level: 47, CombatPower: 9, Missing: 1, Gear: []armoryGear{}, Boards: []armoryBoard{}, Skills: []armorySkill{}}
	if err := keepRank(app, "eu", 2304, "GAPAAAAAAAAAAAAAAAAAAA01", p, true); err != nil {
		t.Fatal(err)
	}
	pending, err := pendingBuilds(app, staleBefore(app, scoutRebuild))
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range pending {
		var id string
		_ = app.DB().NewQuery("SELECT characterId FROM armory_ranks WHERE id = {:id}").Bind(dbx.Params{"id": r.Id}).Row(&id)
		if id == "GAPAAAAAAAAAAAAAAAAAAA01" {
			t.Fatalf("the build missing details is due again: %+v", r)
		}
	}
}

// A top player re-read for its age counts toward a big change when its reading before is at most
// six days old; once 20 of the last 40 such changed by 5% or more, a refresh starts, and no other
// within a week.
func TestBigCombatPowerChangesStartARefresh(t *testing.T) {
	app := newTestApp(t)
	scout := stateOf(app).scout
	rankOf(t, app, 1, "Chanter", 900000, false, map[string]any{"checkedAt": ago(topRecheck + time.Hour)})
	rankOf(t, app, 2, "Chanter", 800000, false, map[string]any{"checkedAt": ago(3 * topRecheck)})
	due, ok, err := scout.nextRecheck(app)
	if err != nil || !ok || due.hit.characterId != "AAAAAAAAAAAAAAAAAAAAA001" || due.hit.region != "eu" || due.hit.serverId != 2304 || due.power != 900000 || !due.drift {
		t.Fatalf("first %+v %v %v", due, ok, err)
	}
	if due, ok, err = scout.nextRecheck(app); err != nil || !ok || due.hit.characterId != "AAAAAAAAAAAAAAAAAAAAA002" || due.drift {
		t.Fatalf("second %+v %v %v", due, ok, err)
	}
	if _, ok, err = scout.nextRecheck(app); err != nil || ok {
		t.Fatalf("both tried: %v %v", ok, err)
	}
	for range driftWindow {
		scout.drifted(app, 100000, 101000)
	}
	for range driftWindow/2 - 1 {
		scout.drifted(app, 100000, 94000)
	}
	if !readSettings(app).refreshAt.IsZero() {
		t.Fatal("a refresh for small changes")
	}
	scout.drifted(app, 100000, 106000)
	started := readSettings(app)
	if started.refreshAt.IsZero() || started.refreshWhy != "power:50" {
		t.Fatalf("refresh %v %q", started.refreshAt, started.refreshWhy)
	}
	for range driftWindow {
		scout.drifted(app, 100000, 120000)
	}
	if again := readSettings(app); !again.refreshAt.Equal(started.refreshAt) {
		t.Fatalf("started again at %v", again.refreshAt)
	}
	if st := refreshStatus(app)["refresh"].(map[string]any); st["by"] != "power" || st["share"] != 50 {
		t.Fatalf("status %+v", st)
	}
}
