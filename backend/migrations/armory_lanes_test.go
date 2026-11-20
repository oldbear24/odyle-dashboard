package migrations

import "testing"

// Kept settings run three readers' lookups and one of the scout's at once, until a superuser
// sets otherwise.
func TestArmoryLanesStartAtThreeAndOne(t *testing.T) {
	app := newMigratedApp(t)
	if err := armoryLanesDown(app); err != nil {
		t.Fatal(err)
	}
	if err := armoryLanesUp(app); err != nil {
		t.Fatal(err)
	}
	record, err := app.FindFirstRecordByFilter("odyle_settings", `id != ""`)
	if err != nil {
		t.Fatal(err)
	}
	if record.GetInt("armoryLanes") != 3 || record.GetInt("scoutLanes") != 1 {
		t.Fatalf("lanes %d and %d", record.GetInt("armoryLanes"), record.GetInt("scoutLanes"))
	}
}
