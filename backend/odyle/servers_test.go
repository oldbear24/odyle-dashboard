package odyle

import (
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
)

// The Global servers as PLAYNC lists them: 23 of each race, every name once.
func TestGlobalServersAsPLAYNCListsThem(t *testing.T) {
	if len(elyos) != 23 || len(asmodian) != 23 {
		t.Fatalf("%d Elyos and %d Asmodian servers, want 23 each", len(elyos), len(asmodian))
	}
	seen := map[string]bool{}
	for _, name := range append(append([]string{}, elyos...), asmodian...) {
		if seen[name] || !pvpServer.MatchString(name) {
			t.Fatalf("server %q twice or not a name", name)
		}
		seen[name] = true
	}
	for _, c := range []struct {
		region string
		id     int
		name   string
	}{{"eu", 1311, "Tahavatha"}, {"eu", 1315, "Kasaka"}, {"eu", 1321, "Gauss"}, {"eu", 1322, "Lamuatan"}, {"eu", 1323, "Nathara"},
		{"eu", 2321, "Agnita"}, {"eu", 2322, "Atiel"}, {"eu", 2323, "Tassin"}, {"eu", 1324, ""}, {"eu", 2324, ""}} {
		if got := armoryServer(c.region, c.id); got != c.name {
			t.Errorf("%s %d: %q, want %q", c.region, c.id, got, c.name)
		}
	}
	if got := searches("Tassin", "GLOBAL_EU"); len(got) != 1 || got[0] != (search{serverId: 2323, region: "eu"}) {
		t.Fatalf("Tassin searches %v", got)
	}
	for old, now := range map[string]string{"Poeta": "Gauss", "Verteron": "Lamuatan", "Tahabata": "Tahavatha", "Kasika": "Kasaka", "Ishalgen": "Agnita", "Altgard": "Atiel", "Agnita": "Agnita", "Lumiel": "Lumiel", "Atlantis": "Atlantis"} {
		if got := globalServer(old); got != now {
			t.Errorf("globalServer(%q) = %q, want %q", old, got, now)
		}
	}
}

// Windows apps before 0.33.1 send other names for seven Global servers: the
// characters they save land under the Global name, and their Agnita (Tassin's id) finds the
// character the migration moved to Tassin.
func TestOlderAppsServerNamesFindTheGlobalServer(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player := newUser(t, app, "Daeva")
	auth := tokenOf(t, player)
	tassin := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Moved", "server": "Tassin", "region": "GLOBAL_EU"})
	agnita := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Stays", "server": "Agnita", "region": "GLOBAL_EU"})
	both := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Twin", "server": "Agnita", "region": "GLOBAL_EU"})
	saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Twin", "server": "Tassin", "region": "GLOBAL_EU"})
	idOf := func(answer map[string]any) (string, string) {
		c, _ := answer["character"].(map[string]any)
		id, _ := c["id"].(string)
		server, _ := c["server"].(string)
		return id, server
	}
	for _, c := range []struct{ name, server, wantServer, wantId string }{
		{"Fresh", "Poeta", "Gauss", ""},
		{"Fresh", "Gauss", "Gauss", "same"},
		{"Moved", "Agnita", "Tassin", tassin.Id},
		{"Stays", "Agnita", "Agnita", agnita.Id},
		{"Twin", "Agnita", "Agnita", both.Id},
		{"New", "Agnita", "Agnita", ""},
		{"Kept", "Lumiel", "Lumiel", ""},
	} {
		answer := ask(t, app, http.MethodPost, "/api/odyle/character", auth, `{"characterName":"`+c.name+`","server":"`+c.server+`","region":"GLOBAL_EU"}`, 200)
		id, server := idOf(answer)
		if server != c.wantServer || (c.wantId != "" && c.wantId != "same" && id != c.wantId) {
			t.Errorf("%s on %s: saved on %s (%s), want %s (%s)", c.name, c.server, server, id, c.wantServer, c.wantId)
		}
	}
	if n, err := app.CountRecords("characters", dbx.HashExp{"user": player.Id, "characterName": "Fresh"}); err != nil || n != 1 {
		t.Fatalf("Fresh saved %d times, %v", n, err)
	}
	// A reading without a character id finds the character the same way.
	session := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	answer := ask(t, app, http.MethodPost, "/api/odyle/report", auth, `{"sessionId":"`+session.Id+`","sequence":1,"characterName":"Moved","server":"Agnita","region":"GLOBAL_EU","value":120,"source":"packet","parserVersion":"global-reference-v2","confirmed":true}`, 200)
	if id, server := idOf(answer); id != tassin.Id || server != "Tassin" {
		t.Fatalf("an older app's reading went to %s on %s, want %s on Tassin", id, server, tassin.Id)
	}
	answer = ask(t, app, http.MethodPost, "/api/odyle/report", auth, `{"sessionId":"`+session.Id+`","sequence":2,"characterName":"Lit","server":"Verteron","region":"GLOBAL_EU","value":120,"source":"packet","parserVersion":"global-reference-v2","confirmed":true}`, 200)
	if _, server := idOf(answer); server != "Lamuatan" {
		t.Fatalf("an older app's new character saved on %s, want Lamuatan", server)
	}
	// PvP players of Windows 0.33.0 come under the Global name too.
	if _, server, _, err := pvpPlayer(map[string]any{"name": "Vexa", "server": "Poeta", "region": "GLOBAL_EU"}, "name", "server", "region"); err != nil || server != "Gauss" {
		t.Fatalf("a PvP player of Poeta: %q, %v", server, err)
	}
}
