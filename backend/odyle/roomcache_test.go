package odyle

import (
	"net/http"
	"testing"
	"time"
)

// The room's week line keeps what each character spent until one of its readings changes.
func TestRoomWeekFollowsEachReading(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	lead := newUser(t, app, "Lead")
	character := saved(t, app, "characters", map[string]any{"user": lead.Id, "characterName": "Lumina", "server": "EU", "region": "GLOBAL_EU", "value": 100, "confirmed": true}).Id
	other := saved(t, app, "characters", map[string]any{"user": lead.Id, "characterName": "Other", "server": "EU", "region": "GLOBAL_EU", "value": 100, "confirmed": true}).Id
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Week", "cost": 40})
	sharingMember(t, app, map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"}, character, other)
	members, err := roomMembers(app, room.Id)
	if err != nil {
		t.Fatal(err)
	}
	rules := readSettings(app)
	spent := func() int64 {
		t.Helper()
		week, err := roomWeekOf(app, rules, members, 40, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		return week["spent"].(int64)
	}
	if n := spent(); n != 0 {
		t.Fatalf("an empty week spent %d", n)
	}
	reading := saved(t, app, "character_readings", map[string]any{"character": character, "value": 60, "adapter": "global-reference-v2", "kind": "spend", "delta": -40})
	if n := spent(); n != 40 {
		t.Fatalf("after a spend: %d", n)
	}
	saved(t, app, "character_readings", map[string]any{"character": other, "value": 20, "adapter": "global-reference-v2", "kind": "spend", "delta": -80})
	if n := spent(); n != 120 {
		t.Fatalf("after a second character's spend: %d", n)
	}
	reading.Set("delta", -10)
	if err := app.Save(reading); err != nil {
		t.Fatal(err)
	}
	if n := spent(); n != 90 {
		t.Fatalf("after a changed reading: %d", n)
	}
	if err := app.Delete(reading); err != nil {
		t.Fatal(err)
	}
	if n := spent(); n != 80 {
		t.Fatalf("after a deleted reading: %d", n)
	}
	// Readings deleted in bulk (retention) forget everything.
	if _, err := app.DB().NewQuery("DELETE FROM character_readings").Execute(); err != nil {
		t.Fatal(err)
	}
	forgetWeekSpends(app)
	if n := spent(); n != 0 {
		t.Fatalf("after the readings went: %d", n)
	}
}

// The classes are kept in memory until a class record changes or an emblem is kept.
func TestClassesAreKeptUntilTheyChange(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Viewer")
	before := len(classIcons(app))
	class := saved(t, app, "game_classes", map[string]any{"pcId": 99990, "name": "Bard", "icon": "class_icon_bard.png"})
	if icons := classIcons(app); icons["Bard"] != "class_icon_bard.png" || len(icons) != before+1 {
		t.Fatalf("a new class: %v", icons)
	}
	if gameClasses(app)[99990].Name != "Bard" {
		t.Fatal("the class id is not named")
	}
	class.Set("icon", "class_icon_bard2.png")
	if err := app.Save(class); err != nil {
		t.Fatal(err)
	}
	listed := ask(t, app, http.MethodGet, "/api/odyle/rooms", tokenOf(t, user), "", 200)["classIcons"].(map[string]any)
	if listed["Bard"] != "class_icon_bard2.png" {
		t.Fatalf("rooms list %v", listed)
	}
	if err := app.Delete(class); err != nil {
		t.Fatal(err)
	}
	if icons := classIcons(app); icons["Bard"] != "" {
		t.Fatalf("a deleted class: %v", icons)
	}
}
