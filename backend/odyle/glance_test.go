package odyle

import (
	"net/http"
	"testing"
	"time"
)

// Rooms at a glance (#51): each room of GET /rooms says how many members it has, how many play
// live now, the cubes their party can open now and its next run; /upcoming?days= reaches further
// than the reminders' 24 hours, up to 60 days.
func TestRoomsSayTheirPartyAndNextRun(t *testing.T) {
	app := newTestApp(t)
	lead, mate := newUser(t, app, "Lead"), newUser(t, app, "Mate")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	leader := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	fresh := stamp(time.Now())
	live := saved(t, app, "characters", map[string]any{"user": lead.Id, "characterName": "Lumina", "server": "EU", "region": "GLOBAL_EU", "value": 130, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": fresh, "lastReadingAt": fresh})
	leader.Set("sharedCharacters", []string{live.Id})
	if err := app.Save(leader); err != nil {
		t.Fatal(err)
	}
	soon := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(26 * time.Hour)), "plannedBy": member.Id, "attendees": []string{leader.Id}})
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Ice Temple", "startsAt": stamp(time.Now().Add(72 * time.Hour)), "plannedBy": member.Id, "attendees": []string{leader.Id}})
	auth := tokenOf(t, lead)
	listed := ask(t, app, http.MethodGet, "/api/odyle/rooms", auth, "", 200)["rooms"].([]any)
	got := listed[0].(map[string]any)
	next, _ := got["nextRun"].(map[string]any)
	if got["memberCount"] != float64(2) || got["liveCount"] != float64(1) || got["partyCubes"] != float64(3) || next["id"] != soon.Id || next["dungeon"] != "Fire Temple" {
		t.Fatalf("room %v", got)
	}
	// Reminders still see the next 24 hours; the library asks for two weeks.
	if runs := ask(t, app, http.MethodGet, "/api/odyle/upcoming", auth, "", 200)["runs"].([]any); len(runs) != 0 {
		t.Fatalf("24 hours: %v", runs)
	}
	if runs := ask(t, app, http.MethodGet, "/api/odyle/upcoming?days=14", auth, "", 200)["runs"].([]any); len(runs) != 2 || runs[0].(map[string]any)["dungeon"] != "Fire Temple" {
		t.Fatalf("two weeks: %v", runs)
	}
	if runs := ask(t, app, http.MethodGet, "/api/odyle/upcoming?days=2", auth, "", 200)["runs"].([]any); len(runs) != 1 {
		t.Fatalf("two days: %v", runs)
	}
}
