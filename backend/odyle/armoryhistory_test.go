package odyle

import (
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// pointOf puts a day of a character's history in, as an earlier keepRank would have.
func pointOf(t *testing.T, app core.App, characterId string, day time.Time, power int64) {
	t.Helper()
	if _, err := app.DB().NewQuery("INSERT INTO armory_history (serverId, characterId, day, combatPower, itemLevel, level) VALUES (2304, {:id}, {:day}, {:power}, {:itemLevel}, 45)").
		Bind(dbx.Params{"id": characterId, "day": historyDay(day), "power": power, "itemLevel": power / 1000}).Execute(); err != nil {
		t.Fatal(err)
	}
}

func historyCount(t *testing.T, app core.App, characterId string) int {
	t.Helper()
	var n int
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM armory_history WHERE characterId = {:id}").Bind(dbx.Params{"id": characterId}).Row(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Each reading of a character keeps one point a day, the last reading of the day; the profile
// sends the last 180 days, the oldest first.
func TestArmoryHistoryKeepsOnePointADay(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	if _, ok := ask(t, app, "GET", armoryPath(id), nil, "", 200)["history"].([]any); !ok {
		t.Fatal("no history list")
	}
	stateOf(app).armory.wait()
	answer := ask(t, app, "GET", armoryPath(id), nil, "", 200)
	history := answer["history"].([]any)
	today := time.Now().UTC().Format("2006-01-02")
	if len(history) != 1 || history[0].(map[string]any)["day"] != today || history[0].(map[string]any)["combatPower"].(float64) != 107458 {
		t.Fatalf("history after a lookup %v", history)
	}
	// The scout's check later that day updates the point.
	p := armoryProfile{Name: "Hero", Class: "Chanter", Level: 45, CombatPower: 108000, ItemLevel: 1200}
	if err := keepRank(app, "eu", 2304, id, p, false); err != nil {
		t.Fatal(err)
	}
	var power, itemLevel int64
	if err := app.DB().NewQuery("SELECT combatPower, itemLevel FROM armory_history WHERE characterId = {:id}").Bind(dbx.Params{"id": id}).Row(&power, &itemLevel); err != nil || power != 108000 || itemLevel != 1200 {
		t.Fatalf("today's point %d, %d (%v)", power, itemLevel, err)
	}
	if n := historyCount(t, app, id); n != 1 {
		t.Fatalf("%d points for one day", n)
	}
	// The last 180 days, the oldest first.
	for d := 1; d <= 200; d++ {
		pointOf(t, app, id, time.Now().AddDate(0, 0, -d), int64(100000-d))
	}
	history = ask(t, app, "GET", armoryPath(id), nil, "", 200)["history"].([]any)
	first, last := history[0].(map[string]any), history[len(history)-1].(map[string]any)
	if len(history) != historyKeep || first["day"] != time.Now().UTC().AddDate(0, 0, -(historyKeep-1)).Format("2006-01-02") || last["day"] != today || last["level"].(float64) != 45 {
		t.Fatalf("%d points, %v to %v", len(history), first, last)
	}
}

// Hiding a character, its profile or its row among the top players, deletes its history and
// keeps none afterwards.
func TestArmoryHistoryGoesWithAHiddenCharacter(t *testing.T) {
	app := newTestApp(t)
	p := armoryProfile{Name: "Hero", Class: "Chanter", Level: 45, CombatPower: 100000, ItemLevel: 1000}
	// A row hidden among the top players.
	rankOf(t, app, 1, "Chanter", 90000, false, nil)
	ranked := "AAAAAAAAAAAAAAAAAAAAA001"
	if err := keepRank(app, "eu", 2304, ranked, p, false); err != nil {
		t.Fatal(err)
	}
	pointOf(t, app, ranked, time.Now().AddDate(0, 0, -3), 90000)
	if n := historyCount(t, app, ranked); n != 2 {
		t.Fatalf("%d points", n)
	}
	row, err := app.FindFirstRecordByFilter("armory_ranks", "characterId = {:id}", dbx.Params{"id": ranked})
	if err != nil {
		t.Fatal(err)
	}
	row.Set("hidden", true)
	if err := app.Save(row); err != nil {
		t.Fatal(err)
	}
	if n := historyCount(t, app, ranked); n != 0 {
		t.Fatalf("%d points of a hidden row", n)
	}
	if err := keepRank(app, "eu", 2304, ranked, p, false); err != nil {
		t.Fatal(err)
	}
	if n := historyCount(t, app, ranked); n != 0 {
		t.Fatalf("a hidden row keeps %d points", n)
	}
	// A hidden profile.
	const profiled = "ProfiledAAAAAAAAAAAAAAA"
	profile := saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": profiled, "name": "Hero", "viewedAt": now()})
	if err := keepRank(app, "eu", 2304, profiled, p, true); err != nil {
		t.Fatal(err)
	}
	if n := historyCount(t, app, profiled); n != 1 {
		t.Fatalf("%d points", n)
	}
	profile.Set("hidden", true)
	if err := app.Save(profile); err != nil {
		t.Fatal(err)
	}
	if n := historyCount(t, app, profiled); n != 0 {
		t.Fatalf("%d points of a hidden profile", n)
	}
	if err := keepRank(app, "eu", 2304, profiled, p, true); err != nil {
		t.Fatal(err)
	}
	if n := historyCount(t, app, profiled); n != 0 {
		t.Fatalf("a hidden profile keeps %d points", n)
	}
}

// The nightly clean-up deletes the points older than 180 days and those of the characters the
// armory no longer keeps, or keeps hidden.
func TestArmoryHistoryIsCleanedNightly(t *testing.T) {
	app := newTestApp(t)
	rankOf(t, app, 1, "Chanter", 100000, false, nil)
	rankOf(t, app, 2, "Chanter", 100000, false, map[string]any{"hidden": true})
	saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": "ProfiledAAAAAAAAAAAAAAA", "name": "Hero", "viewedAt": now()})
	ranked, hidden := "AAAAAAAAAAAAAAAAAAAAA001", "AAAAAAAAAAAAAAAAAAAAA002"
	for _, id := range []string{ranked, hidden, "ProfiledAAAAAAAAAAAAAAA", "GoneAAAAAAAAAAAAAAAAAAA"} {
		pointOf(t, app, id, time.Now(), 100000)
		pointOf(t, app, id, time.Now().AddDate(0, 0, -(historyKeep-1)), 90000)
	}
	pointOf(t, app, ranked, time.Now().AddDate(0, 0, -(historyKeep+1)), 80000)
	if _, err := cleanArmory(app); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]int{ranked: 2, hidden: 0, "ProfiledAAAAAAAAAAAAAAA": 2, "GoneAAAAAAAAAAAAAAAAAAA": 0} {
		if n := historyCount(t, app, id); n != want {
			t.Errorf("%s keeps %d points, not %d", id, n, want)
		}
	}
}

// The profile's history and the clean-up's look-ups use the indexes.
func TestArmoryHistoryUsesItsIndexes(t *testing.T) {
	app := newTestApp(t)
	for name, query := range map[string]string{
		"a profile's days": "SELECT day FROM armory_history WHERE serverId = 2304 AND characterId = {:value} ORDER BY day DESC LIMIT 180",
		"old days":         "SELECT id FROM armory_history WHERE day < {:value}",
		"hidden":           "DELETE FROM armory_history WHERE serverId = 2304 AND characterId = {:value}",
	} {
		if got := queryPlan(t, app, query); !usesAnIndex(got) {
			t.Errorf("%s reads %q", name, got)
		}
	}
}
