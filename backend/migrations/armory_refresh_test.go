package migrations

import "testing"

// Kept settings start with no refresh of the armory's characters, and the fields go again down.
func TestArmoryRefreshStartsWithNone(t *testing.T) {
	app := newMigratedApp(t)
	record, err := app.FindFirstRecordByFilter("odyle_settings", `id != ""`)
	if err != nil {
		t.Fatal(err)
	}
	if !record.GetDateTime("ranksRefreshAt").IsZero() || record.GetString("ranksRefreshWhy") != "" {
		t.Fatalf("refresh %v %q", record.GetDateTime("ranksRefreshAt"), record.GetString("ranksRefreshWhy"))
	}
	if err := armoryRefreshDown(app); err != nil {
		t.Fatal(err)
	}
	settings, err := app.FindCollectionByNameOrId("odyle_settings")
	if err != nil {
		t.Fatal(err)
	}
	if settings.Fields.GetByName("ranksRefreshAt") != nil || settings.Fields.GetByName("ranksRefreshWhy") != nil {
		t.Fatal("the fields stayed")
	}
	if err := armoryRefreshUp(app); err != nil {
		t.Fatal(err)
	}
}
