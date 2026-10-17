package odyle

import (
	"net/http"
	"testing"
)

// The weekly maintenance window (#47): superusers set a day, a start hour (UTC) and a length;
// room snapshots carry it, null while none is set.
func TestTheWeeklyMaintenanceReachesRooms(t *testing.T) {
	app := newTestApp(t)
	lead := newUser(t, app, "Lead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	auth := tokenOf(t, lead)
	if got := ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, auth, "", 200)["maintenance"]; got != nil {
		t.Fatalf("none set: %v", got)
	}
	if _, err := writeSettings(app, body{"maintenance": map[string]any{"day": "wednesday", "hour": float64(6), "hours": float64(3)}}); err != nil {
		t.Fatal(err)
	}
	got, _ := ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, auth, "", 200)["maintenance"].(map[string]any)
	if got["day"] != "wednesday" || got["hour"] != float64(6) || got["hours"] != float64(3) {
		t.Fatalf("window %v", got)
	}
	for _, wrong := range []any{"wednesday", map[string]any{"day": "someday", "hour": float64(6), "hours": float64(3)}, map[string]any{"day": "monday", "hour": float64(24), "hours": float64(3)}, map[string]any{"day": "monday", "hour": float64(6), "hours": float64(13)}, map[string]any{"day": "monday", "hour": 6.5, "hours": float64(3)}} {
		if _, err := writeSettings(app, body{"maintenance": wrong}); err == nil {
			t.Fatalf("%v was taken", wrong)
		}
	}
	if _, err := writeSettings(app, body{"maintenance": map[string]any{"day": ""}}); err != nil || readSettings(app).Maintenance.Day != "" {
		t.Fatalf("turning it off: %v", err)
	}
}
