package odyle

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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
		if got := staticServers().inRegion(c.region, c.id); got != c.name {
			t.Errorf("%s %d: %q, want %q", c.region, c.id, got, c.name)
		}
	}
	if got := staticServers().searches("Tassin", "GLOBAL_EU"); len(got) != 1 || got[0] != (search{serverId: 2323, region: "eu"}) {
		t.Fatalf("Tassin searches %v", got)
	}
	for old, now := range map[string]string{"Poeta": "Gauss", "Verteron": "Lamuatan", "Tahabata": "Tahavatha", "Kasika": "Kasaka", "Ishalgen": "Agnita", "Altgard": "Atiel", "Agnita": "Agnita", "Lumiel": "Lumiel", "Atlantis": "Atlantis"} {
		if got := globalServer(old); got != now {
			t.Errorf("globalServer(%q) = %q, want %q", old, got, now)
		}
	}
}

// Windows apps before 0.34.0 send other names for seven Global servers: the
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

// PLAYNC's server lists: a server opened past the lists is named from them, each region lists
// the servers it has open, a closed one keeps its name, a region that does not answer keeps
// what it had, and a name PLAYNC gives a server the lists name otherwise is not taken.
func TestServersPLAYNCListsAreLearned(t *testing.T) {
	app := newTestApp(t)
	var asked atomic.Int32
	failing, opened := atomic.Bool{}, atomic.Bool{}
	failing.Store(true)
	opened.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked.Add(1)
		q := r.URL.Query()
		if r.URL.Path != "/en-us/api/gameinfo/servers" || q.Get("lang") != "en-us" {
			w.WriteHeader(404)
			return
		}
		region := q.Get("region")
		if region == "la" && failing.Load() {
			w.WriteHeader(500)
			return
		}
		digit, open := map[string]int{"nae": 1, "naw": 2, "eu": 3, "la": 4, "as": 5}[region], map[string]int{"nae": 9, "naw": 5, "eu": 23, "la": 6, "as": 10}[region]
		list := []any{}
		for _, race := range []int{1, 2} {
			for at, name := range map[int][]string{1: elyos, 2: asmodian}[race][:open] {
				if region == "eu" && race*1000+digit*100+at+1 == 2321 {
					name = "Agnitta"
				}
				list = append(list, map[string]any{"raceId": race, "serverId": race*1000 + digit*100 + at + 1, "serverName": name})
			}
		}
		if region == "eu" {
			if opened.Load() {
				list = append(list, map[string]any{"raceId": 1, "serverId": 1324, "serverName": "Ozryn"})
			}
			list = append(list, map[string]any{"raceId": 1, "serverId": 1325, "serverName": "Bad Name!"}, map[string]any{"raceId": 1, "serverId": 1426, "serverName": "Elsewhere"})
		}
		json.NewEncoder(w).Encode(map[string]any{"serverList": list})
	}))
	t.Cleanup(server.Close)
	t.Setenv("PLAYNC_ARMORY_URL", server.URL)

	regionOf := func(answer map[string]any, region string) map[string]any {
		t.Helper()
		list, _ := answer["regions"].([]any)
		for _, r := range list {
			if r := r.(map[string]any); r["region"] == region {
				return r
			}
		}
		t.Fatalf("no %s in %v", region, answer)
		return nil
	}
	count := func(r map[string]any, key string) int { list, _ := r[key].([]any); return len(list) }
	// Before PLAYNC's lists are read, every region lists the 23 servers of each race.
	before := ask(t, app, http.MethodGet, "/api/odyle/armory/servers", nil, "", 200)
	if eu := regionOf(before, "GLOBAL_EU"); count(eu, "elyos") != 23 || count(eu, "asmodian") != 23 || count(eu, "servers") != 46 {
		t.Fatalf("Europe before: %v", eu)
	}
	if err := learnServers(app); err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("South America's failure: %v", err)
	}
	book := serversOf(app)
	if book.name(1324) != "Ozryn" || book.name(1124) != "Ozryn" || book.inRegion("eu", 1324) != "Ozryn" || book.name(1325) != "" || book.name(2321) != "Agnita" {
		t.Fatalf("names %q %q %q %q %q", book.name(1324), book.name(1124), book.inRegion("eu", 1324), book.name(1325), book.name(2321))
	}
	if got := book.searches("Ozryn", "GLOBAL_EU"); len(got) != 1 || got[0] != (search{serverId: 1324, region: "eu"}) {
		t.Fatalf("Ozryn searches %v", got)
	}
	answer := ask(t, app, http.MethodGet, "/api/odyle/armory/servers", nil, "", 200)
	eu, na, sa := regionOf(answer, "GLOBAL_EU"), regionOf(answer, "GLOBAL_NA"), regionOf(answer, "GLOBAL_SA")
	if count(eu, "elyos") != 24 || count(eu, "asmodian") != 23 || count(na, "elyos") != 9 || count(na, "servers") != 18 || count(sa, "elyos") != 24 {
		t.Fatalf("Europe %d/%d, North America %d/%d, South America %d", count(eu, "elyos"), count(eu, "asmodian"), count(na, "elyos"), count(na, "servers"), count(sa, "elyos"))
	}
	if servers, _ := eu["servers"].([]any); servers[23].(map[string]any)["id"] != float64(1324) || servers[23].(map[string]any)["name"] != "Ozryn" {
		t.Fatalf("Europe's servers %v", servers)
	}
	// Ozryn closes and South America answers: Europe no longer lists it, its name stays known.
	failing.Store(false)
	opened.Store(false)
	if err := learnServers(app); err != nil {
		t.Fatal(err)
	}
	answer = ask(t, app, http.MethodGet, "/api/odyle/armory/servers", nil, "", 200)
	if eu, sa := regionOf(answer, "GLOBAL_EU"), regionOf(answer, "GLOBAL_SA"); count(eu, "elyos") != 23 || count(sa, "elyos") != 6 || serversOf(app).name(1324) != "Ozryn" {
		t.Fatalf("after closing: Europe %d, South America %d, %q", count(eu, "elyos"), count(sa, "elyos"), serversOf(app).name(1324))
	}
	// Paused with the armory, PLAYNC is not asked.
	if _, err := writeSettings(app, body{"armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	before2 := asked.Load()
	if err := learnServers(app); err != nil || asked.Load() != before2 {
		t.Fatalf("paused: %v, %d asked", err, asked.Load()-before2)
	}
}
