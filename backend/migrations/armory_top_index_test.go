package migrations

import "testing"

// The top players' index comes and goes with its migration.
func TestArmoryTopIndex(t *testing.T) {
	app := newMigratedApp(t)
	ranks, err := app.FindCollectionByNameOrId("armory_ranks")
	if err != nil {
		t.Fatal(err)
	}
	if ranks.GetIndex("idx_armory_ranks_top") == "" {
		t.Fatal("no top players index")
	}
	if err := armoryTopIndexDown(app); err != nil {
		t.Fatal(err)
	}
	if ranks, _ = app.FindCollectionByNameOrId("armory_ranks"); ranks.GetIndex("idx_armory_ranks_top") != "" {
		t.Fatal("the index stays after the migration is undone")
	}
	if err := armoryTopIndexUp(app); err != nil {
		t.Fatal(err)
	}
}
