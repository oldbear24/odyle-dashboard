package migrations

import "testing"

// armory_ranks keeps a character once per server, found by class and combat power, and goes
// with the migration.
func TestArmoryRanksKeepEachCharacterOnce(t *testing.T) {
	app := newMigratedApp(t)
	ranks, err := app.FindCollectionByNameOrId("armory_ranks")
	if err != nil {
		t.Fatal(err)
	}
	for _, index := range []string{"idx_armory_ranks_character", "idx_armory_ranks_class", "idx_armory_ranks_checked"} {
		if ranks.GetIndex(index) == "" {
			t.Errorf("no index %s", index)
		}
	}
	if ranks.ListRule != nil || ranks.ViewRule != nil {
		t.Fatal("armory_ranks is open to the API")
	}
	if err := armoryRanksDown(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("armory_ranks"); err == nil {
		t.Fatal("armory_ranks stays after the migration is undone")
	}
	if err := armoryRanksUp(app); err != nil {
		t.Fatal(err)
	}
}
