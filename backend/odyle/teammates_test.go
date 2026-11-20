package odyle

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// The names of party and force members the app sends are checked and go to the scout's queue in
// server memory, without the own character's name; nothing is stored, the packet list shows no
// name, and the switch under Server controls refuses them.
func TestTeammatesGoToTheScoutOnly(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player, other := newUser(t, app, "Leader"), newUser(t, app, "Stranger")
	session := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	theirSession := saved(t, app, "publisher_sessions", map[string]any{"user": other.Id, "expiresAt": expiry(86400)})
	c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Scout", "server": "Lumiel", "region": "GLOBAL_EU"})
	token := func(u interface{ NewAuthToken() (string, error) }) map[string]string {
		raw, err := u.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		return map[string]string{"Authorization": raw}
	}
	auth := token(player)
	send := func(sessionId, characterId, adapter, names string) string {
		return `{"sessionId":"` + sessionId + `","characterId":"` + characterId + `","adapter":"` + adapter + `","names":` + names + `}`
	}
	refused := func(name, body string, status int, message string) {
		t.Helper()
		if got := ask(t, app, http.MethodPost, "/api/odyle/teammates", auth, body, status); got["message"] != message {
			t.Fatalf("%s: %v, want %q", name, got, message)
		}
	}
	refused("an unknown adapter", send(session.Id, c.Id, "global-teammates-v0", `["Mate"]`), 400, "This teammate adapter is not accepted.")
	refused("no names", send(session.Id, c.Id, "global-teammates-v1", `[]`), 400, "Teammates are 1 to 48 players' names.")
	refused("too many names", send(session.Id, c.Id, "global-teammates-v1", `["`+strings.Repeat(`A","`, 48)+`B"]`), 400, "Teammates are 1 to 48 players' names.")
	refused("a name with markup", send(session.Id, c.Id, "global-teammates-v1", `["<b>Mate</b>"]`), 400, "A player's name is 1 to 40 letters or digits.")
	refused("a name of another type", send(session.Id, c.Id, "global-teammates-v1", `[42]`), 400, "A player's name is 1 to 40 letters or digits.")
	if got := ask(t, app, http.MethodPost, "/api/odyle/teammates", token(other), send(theirSession.Id, c.Id, "global-teammates-v1", `["Mate"]`), 403); got["message"] != "This character belongs to another account." {
		t.Fatalf("another account's character: %v", got)
	}
	// The own name is left out; the others wait on the character's server, once.
	if got := ask(t, app, http.MethodPost, "/api/odyle/teammates", auth, send(session.Id, c.Id, "global-teammates-v1", `["Mate","scout","Ranger","Mate"]`), 200); got["queued"] != 2.0 || got["serverNow"] == "" {
		t.Fatalf("queued: %v", got)
	}
	scout := stateOf(app).scout
	if len(scout.names) != 2 || scout.names[0] != (scoutName{"Mate", "Lumiel", "GLOBAL_EU", player.Id}) || scout.names[1].name != "Ranger" {
		t.Fatalf("waiting %+v", scout.names)
	}
	if got := ask(t, app, http.MethodPost, "/api/odyle/teammates", auth, send(session.Id, c.Id, "global-teammates-v1", `["Mate"]`), 200); got["queued"] != 0.0 {
		t.Fatalf("again: %v", got)
	}
	// A one-letter name is left out: searching for it would cost the scout every search page.
	if got := ask(t, app, http.MethodPost, "/api/odyle/teammates", auth, send(session.Id, c.Id, "global-teammates-v1", `["Q","Ra"]`), 200); got["queued"] != 1.0 || scout.names[len(scout.names)-1].name != "Ra" {
		t.Fatalf("short names: %v %+v", got, scout.names)
	}
	// The packet list shows the request without the names.
	shown := 0
	for _, p := range packets(app) {
		if p.values["kind"] == "teammates" {
			shown++
		}
		if strings.Contains(fmt.Sprint(p.values), "Mate") {
			t.Fatalf("the packet list shows a name: %v", p.values)
		}
	}
	if shown == 0 {
		t.Fatal("the packet list shows no teammates request")
	}
	// While the armory is paused nothing waits; switched off, the adapter is refused.
	if _, err := writeSettings(app, body{"armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	if got := ask(t, app, http.MethodPost, "/api/odyle/teammates", auth, send(session.Id, c.Id, "global-teammates-v1", `["Healer"]`), 200); got["queued"] != 0.0 || len(scout.names) != 3 {
		t.Fatalf("paused: %v", got)
	}
	if _, err := writeSettings(app, body{"armoryPaused": false, "adapters": map[string]any{"extra": []any{}, "disabled": []any{"global-teammates-v1"}}}); err != nil {
		t.Fatal(err)
	}
	refused("a switched off adapter", send(session.Id, c.Id, "global-teammates-v1", `["Healer"]`), 400, "This teammate adapter is not accepted.")
	if got := countOf(t, app, "armory_ranks"); got != 0 {
		t.Fatalf("%d rows kept", got)
	}
}
