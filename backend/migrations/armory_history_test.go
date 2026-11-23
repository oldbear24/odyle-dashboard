package migrations

import (
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// armory_history keeps a character once a day, starts with the day each shown character of the
// top players was last checked, and goes with the migration.
func TestArmoryHistory(t *testing.T) {
	app := newMigratedApp(t)
	history, err := app.FindCollectionByNameOrId("armory_history")
	if err != nil {
		t.Fatal(err)
	}
	for _, index := range []string{"idx_armory_history_day", "idx_armory_history_old"} {
		if history.GetIndex(index) == "" {
			t.Errorf("no index %s", index)
		}
	}
	if history.ListRule != nil || history.ViewRule != nil || history.CreateRule != nil {
		t.Fatal("armory_history is open to the API")
	}
	if err := armoryHistoryDown(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("armory_history"); err == nil {
		t.Fatal("armory_history stays after the migration is undone")
	}
	insert := func(collection string, values dbx.Params) {
		t.Helper()
		values["id"] = core.GenerateDefaultRandomId()
		if _, err := app.DB().Insert(collection, values).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	rank := func(characterId string, power int, hidden bool, checkedAt string) {
		insert("armory_ranks", dbx.Params{"region": "eu", "serverId": 2304, "characterId": characterId, "name": "Ka", "class": "Cleric", "level": 45, "combatPower": power, "itemLevel": 1500, "checkedAt": checkedAt, "hidden": hidden})
	}
	rank("ShownAAAAAAAAAAAAAAAAAA", 120000, false, "2026-11-20 18:30:00.000Z")
	rank("HiddenAAAAAAAAAAAAAAAAA", 130000, true, "2026-11-20 18:30:00.000Z")
	rank("ProfileHiddenAAAAAAAAAA", 140000, false, "2026-11-20 18:30:00.000Z")
	rank("UncheckedAAAAAAAAAAAAAA", 150000, false, "")
	insert("armory_profiles", dbx.Params{"region": "eu", "serverId": 2304, "characterId": "ProfileHiddenAAAAAAAAAA", "hidden": true})
	if err := armoryHistoryUp(app); err != nil {
		t.Fatal(err)
	}
	var points []struct {
		CharacterId string `db:"characterId"`
		Day         string `db:"day"`
		CombatPower int    `db:"combatPower"`
		ItemLevel   int    `db:"itemLevel"`
		Level       int    `db:"level"`
		Created     string `db:"created"`
	}
	if err := app.DB().NewQuery("SELECT characterId, day, combatPower, itemLevel, level, created FROM armory_history").All(&points); err != nil {
		t.Fatal(err)
	}
	if len(points) != 1 {
		t.Fatalf("%d points: %+v", len(points), points)
	}
	if p := points[0]; p.CharacterId != "ShownAAAAAAAAAAAAAAAAAA" || p.Day != "2026-11-20 00:00:00.000Z" || p.CombatPower != 120000 || p.ItemLevel != 1500 || p.Level != 45 || p.Created == "" {
		t.Fatalf("point %+v", p)
	}
	// One point a character a day.
	if _, err := app.DB().NewQuery("INSERT INTO armory_history (serverId, characterId, day) VALUES (2304, 'ShownAAAAAAAAAAAAAAAAAA', '2026-11-20 00:00:00.000Z')").Execute(); err == nil {
		t.Fatal("a second point on the same day")
	}
}
