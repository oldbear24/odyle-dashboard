package migrations

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// 1.0.0 refuses data the one-time moves it dropped have not finished with: images still in
// pb_data/armory_images, and armory profiles kept before the top players existed. A server that
// ran 0.62.0 or newer, or a new one, passes.
func TestUpgradeFloor(t *testing.T) {
	app := newMigratedApp(t)
	if err := upgradeFloor(app); err != nil {
		t.Fatalf("a new server: %v", err)
	}
	// Images 0.67.1 has not imported yet.
	dir := filepath.Join(app.DataDir(), "armory_images")
	if err := os.MkdirAll(filepath.Join(dir, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := upgradeFloor(app); err != nil {
		t.Fatalf("an empty folder: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Icon_Old.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := upgradeFloor(app); err == nil || !strings.Contains(err.Error(), "1 armory images kept before 0.61.0") || !strings.Contains(err.Error(), "Run Odyle 0.67.1 first") {
		t.Fatalf("an image left: %v", err)
	}
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	// Profiles kept before 0.62.0: none of them ranked. One without a character does not count.
	profile := func(characterId, profile string) {
		t.Helper()
		if _, err := app.DB().Insert("armory_profiles", dbx.Params{"id": core.GenerateDefaultRandomId(), "region": "eu", "serverId": 2304, "characterId": characterId, "fetchedAt": "2026-11-01 10:00:00.000Z", "profile": profile}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	profile("EmptyAAAAAAAAAAAAAAAAAA", `{"name":""}`)
	if err := upgradeFloor(app); err != nil {
		t.Fatalf("a profile without a character: %v", err)
	}
	profile("KeptAAAAAAAAAAAAAAAAAAA", `{"v":3,"name":"Kept","class":"Cleric"}`)
	if err := upgradeFloor(app); err == nil || !strings.Contains(err.Error(), "1 armory profiles were kept before 0.62.0") {
		t.Fatalf("an unranked profile: %v", err)
	}
	// Ranked by 0.62.0 or newer: the top players have rows.
	if _, err := app.DB().Insert("armory_ranks", dbx.Params{"id": core.GenerateDefaultRandomId(), "region": "eu", "serverId": 2304, "characterId": "KeptAAAAAAAAAAAAAAAAAAA", "name": "Kept", "class": "Cleric"}).Execute(); err != nil {
		t.Fatal(err)
	}
	if err := upgradeFloor(app); err != nil {
		t.Fatalf("a ranked armory: %v", err)
	}
}

// The fields kept for clients before Odyle for Windows 0.37.0 go, and so do the reader sessions
// opened without a device key, their characters turning stale; undone, the fields come back.
func TestOldClientFields(t *testing.T) {
	app := newMigratedApp(t)
	for collection, name := range map[string]string{"party_rooms": "cost", "room_runs": "remindedAt"} {
		c, err := app.FindCollectionByNameOrId(collection)
		if err != nil {
			t.Fatal(err)
		}
		if c.Fields.GetByName(name) != nil {
			t.Fatalf("%s.%s stays", collection, name)
		}
	}
	if err := oldClientFieldsDown(app); err != nil {
		t.Fatal(err)
	}
	users, _ := app.FindCollectionByNameOrId("users")
	user := core.NewRecord(users)
	user.SetEmail("reader@test.invalid")
	user.SetPassword("password-for-tests-only")
	user.Set("displayName", "Reader")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	insert := func(collection string, values dbx.Params) string {
		t.Helper()
		values["id"] = core.GenerateDefaultRandomId()
		if _, err := app.DB().Insert(collection, values).Execute(); err != nil {
			t.Fatal(err)
		}
		return values["id"].(string)
	}
	device := insert("desktop_devices", dbx.Params{"user": user.Id, "digest": "digest"})
	keyless := insert("publisher_sessions", dbx.Params{"user": user.Id, "expiresAt": "2099-01-01 00:00:00.000Z"})
	paired := insert("publisher_sessions", dbx.Params{"user": user.Id, "device": device, "expiresAt": "2099-01-01 00:00:00.000Z"})
	stale := insert("characters", dbx.Params{"user": user.Id, "characterName": "Old", "server": "Lumiel", "region": "GLOBAL_EU", "value": 90, "valid": true, "readingSession": keyless})
	live := insert("characters", dbx.Params{"user": user.Id, "characterName": "New", "server": "Lumiel", "region": "GLOBAL_EU", "value": 120, "valid": true, "readingSession": paired})
	if err := oldClientFieldsUp(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindRecordById("publisher_sessions", keyless); err == nil {
		t.Fatal("a session without a device key stays")
	}
	if _, err := app.FindRecordById("publisher_sessions", paired); err != nil {
		t.Fatalf("a paired PC's session ended: %v", err)
	}
	if c, _ := app.FindRecordById("characters", stale); c.GetBool("valid") || c.GetInt("value") != 90 || c.GetString("readingSession") != "" {
		t.Fatalf("the keyless session's character: valid %v, value %d", c.GetBool("valid"), c.GetInt("value"))
	}
	if c, _ := app.FindRecordById("characters", live); !c.GetBool("valid") || c.GetString("readingSession") != paired {
		t.Fatal("the paired session's character turned stale")
	}
}
