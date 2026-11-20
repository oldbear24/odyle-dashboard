package migrations

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The profiles kept before name their class and combat power in the new fields; a profile not
// fetched yet (null) or one without them keeps them empty.
func TestArmoryProfilesNameTheirClassAndCombatPower(t *testing.T) {
	app := newMigratedApp(t)
	if err := armoryClassPowerDown(app); err != nil {
		t.Fatal(err)
	}
	profiles, err := app.FindCollectionByNameOrId("armory_profiles")
	if err != nil {
		t.Fatal(err)
	}
	save := func(id string, profile any) {
		t.Helper()
		r := core.NewRecord(profiles)
		r.Set("region", "eu")
		r.Set("serverId", 2304)
		r.Set("characterId", id)
		r.Set("profile", profile)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
	save("AAAAAAAAAAAAAAAAAAAAAAA1", map[string]any{"v": 2, "name": "Ka", "class": "Chanter", "combatPower": 107458})
	save("AAAAAAAAAAAAAAAAAAAAAAA2", nil)
	save("AAAAAAAAAAAAAAAAAAAAAAA3", map[string]any{"name": "Old"})
	if err := armoryClassPowerUp(app); err != nil {
		t.Fatal(err)
	}
	rows := []struct {
		Id          string `db:"characterId"`
		Class       string `db:"class"`
		CombatPower int64  `db:"combatPower"`
	}{}
	if err := app.DB().NewQuery("SELECT characterId, class, combatPower FROM armory_profiles ORDER BY characterId").All(&rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || rows[0].Class != "Chanter" || rows[0].CombatPower != 107458 || rows[1].Class != "" || rows[1].CombatPower != 0 || rows[2].Class != "" || rows[2].CombatPower != 0 {
		t.Fatalf("profiles %+v", rows)
	}
	collection, err := app.FindCollectionByNameOrId("armory_profiles")
	if err != nil {
		t.Fatal(err)
	}
	if collection.GetIndex("idx_armory_class_power") == "" {
		t.Fatal("no index by class and combat power")
	}
}
