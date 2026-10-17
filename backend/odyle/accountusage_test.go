package odyle

import (
	"testing"
)

// The account page's numbers (#49): usage against the limits, when the inactive-account clean-up
// would delete the account, the paused switches and each reader's app version.
func TestTheAccountSaysWhatItUsesAndWhenItWouldBeDeleted(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true, "remindersPaused": true}); err != nil {
		t.Fatal(err)
	}
	player := newUser(t, app, "Counted")
	room := saved(t, app, "party_rooms", map[string]any{"owner": player.Id, "name": "Mine", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "owner"})
	newGameCharacter(t, app, player.Id, "One")
	saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400), "appVersion": "0.15.0"})
	auth := tokenOf(t, player)
	answer := ask(t, app, "GET", "/api/odyle/account", auth, "", 200)
	usage, _ := answer["usage"].(map[string]any)
	if usage["ownedRooms"] != float64(1) || usage["memberships"] != float64(1) || usage["characters"] != float64(1) || usage["desktopDevices"] != float64(0) {
		t.Fatalf("usage %v", usage)
	}
	if paused, _ := answer["paused"].(map[string]any); paused["reminders"] != true || paused["pairing"] != false {
		t.Fatalf("paused %v", paused)
	}
	if retention, _ := answer["retention"].(map[string]any); retention["deleteAfter"] != "" {
		t.Fatalf("no clean-up, no date: %v", retention)
	}
	apps, _ := answer["apps"].([]any)
	if len(apps) != 1 || apps[0].(map[string]any)["appVersion"] != "0.15.0" {
		t.Fatalf("apps %v", apps)
	}
	if _, err := writeSettings(app, body{"inactiveAccountDays": float64(90)}); err != nil {
		t.Fatal(err)
	}
	retention, _ := ask(t, app, "GET", "/api/odyle/account", auth, "", 200)["retention"].(map[string]any)
	if retention["inactiveAccountDays"] != float64(90) || retention["deleteAfter"] == "" {
		t.Fatalf("with a clean-up period, a date: %v", retention)
	}
}
