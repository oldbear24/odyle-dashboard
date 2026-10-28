package odyle

import (
	"net/http"
	"testing"
)

// The party and force ids the app sends are checked, kept once per change, reach the room with
// the shared character, and are forgotten when the reading ends.
func TestGameGroupsReachTheRoomAndEndWithTheReading(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player, mate, other := newUser(t, app, "Leader"), newUser(t, app, "Mate"), newUser(t, app, "Stranger")
	session := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	theirSession := saved(t, app, "publisher_sessions", map[string]any{"user": other.Id, "expiresAt": expiry(86400)})
	c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Scout", "server": "Lumiel", "region": "GLOBAL_EU", "readingSession": session.Id})
	room := saved(t, app, "party_rooms", map[string]any{"owner": player.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "owner", "sharedCharacters": []string{c.Id}})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	token := func(u interface{ NewAuthToken() (string, error) }) map[string]string {
		raw, err := u.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		return map[string]string{"Authorization": raw}
	}
	auth, mates := token(player), token(mate)
	report := func(sessionId, characterId, adapter, party, force string) string {
		return `{"sessionId":"` + sessionId + `","characterId":"` + characterId + `","adapter":"` + adapter + `","party":` + party + `,"force":` + force + `}`
	}
	stored := func() gameGroup {
		t.Helper()
		record, err := app.FindRecordById("characters", c.Id)
		if err != nil {
			t.Fatal(err)
		}
		return gameGroupOf(viewOf[Character](record))
	}
	refused := func(name, body string, status int, message string) {
		t.Helper()
		if got := ask(t, app, http.MethodPost, "/api/odyle/game-group", auth, body, status); got["message"] != message {
			t.Fatalf("%s: %v, want %q", name, got, message)
		}
	}
	refused("an unknown adapter", report(session.Id, c.Id, "global-group-v0", `"ba0b0600b2dff723"`, "null"), 400, "This group adapter is not accepted.")
	refused("an id that is not 16 hex digits", report(session.Id, c.Id, "global-group-v1", `"BA0B0600B2DFF723"`, "null"), 400, "A party id is 16 hexadecimal digits or null.")
	refused("a force id of another type", report(session.Id, c.Id, "global-group-v1", "null", "42"), 400, "A force id is 16 hexadecimal digits or null.")
	if got := ask(t, app, http.MethodPost, "/api/odyle/game-group", token(other), report(theirSession.Id, c.Id, "global-group-v1", `"ba0b0600b2dff723"`, "null"), 403); got["message"] != "This character belongs to another account." {
		t.Fatalf("another account's character: %v", got)
	}
	ask(t, app, http.MethodPost, "/api/odyle/game-group", auth, report(session.Id, c.Id, "global-group-v1", `"ba0b0600b2dff723"`, "null"), 200)
	first := stored()
	if first.Party != "ba0b0600b2dff723" || first.Force != "" || first.At == "" {
		t.Fatalf("after the party roster: %+v", first)
	}
	ask(t, app, http.MethodPost, "/api/odyle/game-group", auth, report(session.Id, c.Id, "global-group-v1", `"ba0b0600b2dff723"`, "null"), 200)
	if again := stored(); again != first {
		t.Fatalf("the same party again changed it: %+v, was %+v", again, first)
	}
	ask(t, app, http.MethodPost, "/api/odyle/game-group", auth, report(session.Id, c.Id, "global-group-v1", `"ba0b0600b2dff723"`, `"591a0000b2dff723"`), 200)
	if g := stored(); g.Party != "ba0b0600b2dff723" || g.Force != "591a0000b2dff723" {
		t.Fatalf("after the force roster: %+v", g)
	}
	// A room member sees the party and the force with the shared character.
	snapshot := ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, mates, "", 200)
	var seen map[string]any
	for _, m := range snapshot["members"].([]any) {
		for _, ch := range m.(map[string]any)["characters"].([]any) {
			if ch := ch.(map[string]any); ch["id"] == c.Id {
				seen, _ = ch["gameGroup"].(map[string]any)
			}
		}
	}
	if seen["party"] != "ba0b0600b2dff723" || seen["force"] != "591a0000b2dff723" {
		t.Fatalf("the room sees %v, want the party and the force", seen)
	}
	// Leaving both clears it.
	ask(t, app, http.MethodPost, "/api/odyle/game-group", auth, report(session.Id, c.Id, "global-group-v1", "null", "null"), 200)
	if record, _ := app.FindRecordById("characters", c.Id); record.GetString("gameGroup") != "null" && record.GetString("gameGroup") != "" {
		t.Fatalf("after leaving: %q, want null", record.GetString("gameGroup"))
	}
	// A reading that ends forgets the party: the app cannot tell what happened to it meanwhile.
	ask(t, app, http.MethodPost, "/api/odyle/game-group", auth, report(session.Id, c.Id, "global-group-v1", `"ba0b0600b2dff723"`, "null"), 200)
	ask(t, app, http.MethodPost, "/api/odyle/invalidate", auth, `{"sessionId":"`+session.Id+`","characterId":"`+c.Id+`"}`, 200)
	if g := stored(); g.Party != "" || g.Force != "" {
		t.Fatalf("after the reading ended: %+v, want none", g)
	}
	// Server controls switch the adapter off like a reading adapter; paused readers send nothing.
	if _, err := writeSettings(app, body{"adapters": map[string]any{"extra": []any{}, "disabled": []any{"global-group-v1"}}}); err != nil {
		t.Fatal(err)
	}
	refused("a switched-off adapter", report(session.Id, c.Id, "global-group-v1", `"ba0b0600b2dff723"`, "null"), 400, "This group adapter is not accepted.")
	if _, err := writeSettings(app, body{"adapters": map[string]any{"extra": []any{}, "disabled": []any{}}, "readerPaused": true}); err != nil {
		t.Fatal(err)
	}
	refused("paused readers", report(session.Id, c.Id, "global-group-v1", `"ba0b0600b2dff723"`, "null"), 503, "Packet readers are paused by the server operators.")
}
