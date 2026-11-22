package odyle

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
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

// A character is one per account, server id and name: NA-East and NA-West servers of one name
// are two servers, a server the backend cannot name keeps its characters apart by name, and they
// take its id once PLAYNC lists it. A renamed server keeps its characters, and moving a character
// to NA-West moves its id.
func TestCharactersAreFoundByServerId(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player := newUser(t, app, "Daeva")
	auth, session := pairedReader(t, app, player)
	save := func(name, server, region string) (string, string, float64) {
		t.Helper()
		answer := ask(t, app, http.MethodPost, "/api/odyle/character", auth, `{"characterName":"`+name+`","server":"`+server+`","region":"`+region+`"}`, 200)
		c, _ := answer["character"].(map[string]any)
		id, _ := c["id"].(string)
		saved, _ := c["server"].(string)
		serverId, _ := c["serverId"].(float64)
		return id, saved, serverId
	}
	lumiel, _, id := save("Kael", "Lumiel", "GLOBAL_EU")
	if id != 2304 {
		t.Fatalf("Lumiel in Europe is %v", id)
	}
	if again, _, _ := save("Kael", "Lumiel", "GLOBAL_EU"); again != lumiel {
		t.Fatal("the same character was saved twice")
	}
	east, _, eastId := save("Kael", "Siel", "GLOBAL_NA")
	west, _, westId := save("Kael", "Siel", "GLOBAL_NAW")
	if east == west || eastId != 1101 || westId != 1201 {
		t.Fatalf("NA-East %s (%v) and NA-West %s (%v)", east, eastId, west, westId)
	}
	far, _, farId := save("Kael", "Farland", "GLOBAL_EU")
	near, _, _ := save("Kael", "Nearland", "GLOBAL_EU")
	if again, _, _ := save("Kael", "Farland", "GLOBAL_EU"); farId != 0 || far == near || again != far {
		t.Fatalf("an unknown server: %s (%v), again %s, another %s", far, farId, again, near)
	}
	// One account cannot keep two records of a character on one server.
	if _, err := save2(app, player.Id, "Kael", "Lumiel", "GLOBAL_EU"); err == nil {
		t.Fatal("a second Kael on Lumiel was saved")
	}

	// PLAYNC lists Farland as Europe's 24th Elyos server: its character takes the id.
	saved(t, app, "game_servers", map[string]any{"serverId": 1324, "name": "Farland", "open": true})
	stateOf(app).serverBook.Store(nil)
	if err := fillServerIds(app); err != nil {
		t.Fatal(err)
	}
	if c, _ := app.FindRecordById("characters", far); c.GetInt("serverId") != 1324 {
		t.Fatalf("Farland's character has id %d", c.GetInt("serverId"))
	}
	// Renamed, the server keeps its character, also when something saves it before its next reading
	// (its reader session ending, say): a reading under the new name finds it and names it so.
	if _, err := app.DB().NewQuery("UPDATE game_servers SET name = 'Farreach' WHERE serverId = 1324").Execute(); err != nil {
		t.Fatal(err)
	}
	stateOf(app).serverBook.Store(nil)
	between, _ := app.FindRecordById("characters", far)
	between.Set("valid", false)
	if err := app.Save(between); err != nil {
		t.Fatal(err)
	}
	if kept, _ := app.FindRecordById("characters", far); kept.GetInt("serverId") != 1324 {
		t.Fatalf("saved after the rename, the character has id %d", kept.GetInt("serverId"))
	}
	answer := ask(t, app, http.MethodPost, "/api/odyle/report", auth, `{"sessionId":"`+session.Id+`","sequence":1,"characterName":"Kael","server":"Farreach","region":"GLOBAL_EU","value":120,"source":"packet","parserVersion":"global-reference-v2","confirmed":true}`, 200)
	if c, _ := answer["character"].(map[string]any); c["id"] != far || c["server"] != "Farreach" || c["serverId"] != float64(1324) {
		t.Fatalf("a reading on the renamed server: %v", c)
	}

	// The daily lookup finds an NA character on NA-West: it moves there with the West's id,
	// unless the account has it there already.
	alone, _, _ := save("Wanderer", "Nezekan", "GLOBAL_NA")
	for _, c := range []struct {
		id     string
		region string
	}{{alone, "GLOBAL_NAW"}, {east, "GLOBAL_NA"}} {
		record, err := findAs[Character](app, "characters", c.id)
		if err != nil {
			t.Fatal(err)
		}
		setOfficial(app, record, officialHit{id: "-", region: "naw", serverId: 1000 + 200 + slices.Index(elyos, record.Server()) + 1})
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
		if moved, _ := app.FindRecordById("characters", c.id); moved.GetString("region") != c.region || moved.GetInt("serverId") != serversOf(app).id(c.region, record.Server()) {
			t.Fatalf("%s: %s, id %d", record.Name(), moved.GetString("region"), moved.GetInt("serverId"))
		}
	}
}

// save2 saves a character of the account straight into the collection.
func save2(app core.App, user, name, server, region string) (*core.Record, error) {
	c, err := newRecord(app, "characters")
	if err != nil {
		return nil, err
	}
	c.Set("user", user)
	c.Set("characterName", name)
	c.Set("server", server)
	c.Set("region", region)
	return c, app.Save(c)
}
