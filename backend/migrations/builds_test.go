package migrations

import "testing"

// Builds are kept per account, deleted with it, without API rules, and one share code names one
// build; going down removes the collection and up brings it back.
func TestBuildsAreKeptPerAccount(t *testing.T) {
	app := newMigratedApp(t)
	builds, err := app.FindCollectionByNameOrId("builds")
	if err != nil {
		t.Fatal(err)
	}
	if builds.ListRule != nil || builds.ViewRule != nil || builds.CreateRule != nil || builds.UpdateRule != nil || builds.DeleteRule != nil {
		t.Fatalf("rules %v", builds)
	}
	for _, name := range []string{"user", "name", "class", "plan", "share", "created", "updated"} {
		if builds.Fields.GetByName(name) == nil {
			t.Fatalf("no field %s", name)
		}
	}
	if len(builds.Indexes) != 2 {
		t.Fatalf("indexes %v", builds.Indexes)
	}
	if err := buildsDown(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("builds"); err == nil {
		t.Fatal("builds are still kept")
	}
	if err := buildsUp(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("builds"); err != nil {
		t.Fatal(err)
	}
}
