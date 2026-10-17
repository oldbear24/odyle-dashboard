package odyle

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
)

// officialInfo and officialEquipment are shaped like PLAYNC's answers (docs/armory.md).
func officialInfo(name string) map[string]any {
	return map[string]any{
		"profile": map[string]any{"characterName": name, "characterLevel": 45, "className": "Chanter", "pcId": 36, "combatPower": 107458, "raceName": "Asmodians", "serverName": "Lumiel", "titleName": "Golden Glow", "titleGrade": "Unique"},
		"stat": map[string]any{"statList": []any{
			map[string]any{"type": "STR", "name": "Might", "value": 45}, map[string]any{"type": "WIS", "name": "Willpower", "value": 8},
			map[string]any{"type": "Justice", "name": "Justice [Nezekan]", "value": 41}, map[string]any{"type": "ItemLevel", "name": "아이템레벨", "value": 1671},
		}},
		"daevanion": map[string]any{"boardList": []any{map[string]any{"name": "Nezekan", "openNodeCount": 12, "totalNodeCount": 40, "open": 1}}},
	}
}

func officialEquipment() map[string]any {
	return map[string]any{
		"equipment": map[string]any{"equipmentList": []any{
			map[string]any{"slotPos": 5, "slotPosName": "Torso", "name": "Vakron Breastplate", "grade": "Unique", "enchantLevel": 10, "exceedLevel": 0},
			map[string]any{"slotPos": 1, "slotPosName": "MainHand", "name": "Enraged Kromede Rod", "grade": "Unique", "enchantLevel": 15, "exceedLevel": 3, "icon": "https://assets.playnccdn.com/x.png"},
		}, "skinList": []any{map[string]any{"slotPosName": "Torso", "name": "A skin"}}},
		"petwing": map[string]any{"pet": map[string]any{"name": "Pagati", "level": 3}, "wing": map[string]any{"name": "Forest Spirit Wings", "grade": "Unique", "enchantLevel": 0}},
		"skill":   map[string]any{"skillList": []any{map[string]any{"name": "Left out"}}},
	}
}

// decoded is v as PLAYNC's answer arrives: through JSON, numbers as float64.
func decoded(t *testing.T, v map[string]any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestArmoryKeepsWhatTheOfficialPagesList(t *testing.T) {
	p, err := readArmory(decoded(t, officialInfo("<strong>Ka</strong>")), decoded(t, officialEquipment()))
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Ka" || p.Level != 45 || p.Class != "Chanter" || p.CombatPower != 107458 || p.ItemLevel != 1671 || p.Server != "Lumiel" || p.Title != "Golden Glow" {
		t.Fatalf("profile %+v", p)
	}
	if len(p.Stats) != 3 || !p.Stats[0].Primary || p.Stats[2].Primary || p.Stats[2].Name != "Justice" || p.Stats[2].Deity != "Nezekan" {
		t.Fatalf("stats %+v", p.Stats)
	}
	slots := []string{}
	for _, g := range p.Gear {
		slots = append(slots, g.Slot)
	}
	if strings.Join(slots, ",") != "MainHand,Torso,Wings,Pet" || p.Gear[0].Enchant != 15 || p.Gear[0].Exceed != 3 || p.Gear[3].Level != 3 {
		t.Fatalf("gear %+v", p.Gear)
	}
	if len(p.Boards) != 1 || p.Boards[0].Open != 12 || p.Boards[0].Total != 40 {
		t.Fatalf("boards %+v", p.Boards)
	}
	// Skills, skins and icons are not kept.
	raw, _ := json.Marshal(p)
	for _, left := range []string{"Left out", "A skin", "playnccdn"} {
		if strings.Contains(string(raw), left) {
			t.Fatalf("kept %q: %s", left, raw)
		}
	}
	if _, err := readArmory(map[string]any{"detail": "Resource not found"}, decoded(t, officialEquipment())); err == nil {
		t.Fatal("an answer without a character was read")
	}
}

func TestArmoryServerIdsBelongToTheirRegion(t *testing.T) {
	for _, c := range []struct {
		region string
		id     int
		name   string
	}{{"eu", 2304, "Lumiel"}, {"eu", 1301, "Siel"}, {"nae", 1150, "Hebran"}, {"naw", 2201, "Israphel"}, {"as", 1503, "Vaizel"},
		{"nae", 2304, ""}, {"eu", 2351, ""}, {"eu", 2300, ""}, {"eu", 3304, ""}, {"xx", 2304, ""}} {
		if got := armoryServer(c.region, c.id); got != c.name {
			t.Errorf("%s %d: %q, want %q", c.region, c.id, got, c.name)
		}
	}
}

// armoryStand stands in for PLAYNC's character pages and search: characters whose id starts
// with "missing" are not listed, "refused" ones get 429; gate, when set, holds each answer.
type armoryStand struct {
	requests, searches atomic.Int32
	gate               chan struct{}
	url                string
}

func (s *armoryStand) serve(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.gate != nil {
			<-s.gate
		}
		q := r.URL.Query()
		if r.URL.Path == "/search" {
			s.searches.Add(1)
			id := url.QueryEscape("kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=")
			serverId, _ := json.Marshal(q.Get("serverId"))
			json.NewEncoder(w).Encode(map[string]any{"list": []any{
				map[string]any{"characterId": "longer" + id, "name": "<strong>" + q.Get("keyword") + "</strong>x", "level": 22, "race": 2, "serverId": json.RawMessage(serverId)},
				map[string]any{"characterId": id, "name": "<strong>" + q.Get("keyword") + "</strong>", "level": 45, "race": 2, "serverId": json.RawMessage(serverId)},
				map[string]any{"characterId": "bad id", "name": q.Get("keyword"), "serverId": 2304},
			}})
			return
		}
		s.requests.Add(1)
		id := q.Get("characterId")
		switch {
		case q.Get("region") == "" || q.Get("serverId") == "" || q.Get("lang") != "en-US":
			w.WriteHeader(400)
		case strings.HasPrefix(id, "missing"):
			w.WriteHeader(404)
			w.Write([]byte(`{"status":404,"code":"resource.not_found"}`))
		case strings.HasPrefix(id, "refused"):
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
		case r.URL.Path == "/api/character/info":
			json.NewEncoder(w).Encode(officialInfo("Hero"))
		case r.URL.Path == "/api/character/equipment":
			json.NewEncoder(w).Encode(officialEquipment())
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(server.Close)
	s.url = server.URL
	t.Setenv("PLAYNC_ARMORY_URL", server.URL)
	t.Setenv("PLAYNC_SEARCH_URL", server.URL+"/search")
}

func fastArmory(t *testing.T) {
	pace, gap := armoryPace, armorySearchGap
	armoryPace, armorySearchGap = 20*time.Millisecond, 10*time.Millisecond
	t.Cleanup(func() { armoryPace, armorySearchGap = pace, gap })
}

func armoryPath(id string) string { return "/api/odyle/armory/eu/2304/" + id }

func TestArmoryFetchesProfilesThroughTheQueueAndKeepsThem(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	first := ask(t, app, "GET", armoryPath(id), nil, "", 200)
	if first["state"] != "queued" || first["profile"] != nil || first["server"] != "Lumiel" || first["retryAfter"].(float64) < 2 {
		t.Fatalf("first look: %v", first)
	}
	stateOf(app).armory.wait()
	kept := ask(t, app, "GET", armoryPath(id), nil, "", 200)
	profile, _ := kept["profile"].(map[string]any)
	if kept["state"] != "fresh" || profile["name"] != "Hero" || profile["combatPower"].(float64) != 107458 || kept["fetchedAt"] == "" || stand.requests.Load() != 2 {
		t.Fatalf("kept: %v after %d requests", kept, stand.requests.Load())
	}
	// A fresh profile is read from the database, a Refresh only counts after 15 minutes.
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	if again := ask(t, app, "GET", armoryPath(id)+"?refresh=1", nil, "", 200); again["state"] != "fresh" || stand.requests.Load() != 2 {
		t.Fatalf("refreshed at once: %v", again)
	}
	if _, err := app.DB().NewQuery("UPDATE armory_profiles SET fetchedAt = {:at}").Bind(dbx.Params{"at": ago(20 * time.Minute)}).Execute(); err != nil {
		t.Fatal(err)
	}
	if again := ask(t, app, "GET", armoryPath(id)+"?refresh=1", nil, "", 200); again["state"] != "queued" || again["profile"] == nil {
		t.Fatalf("a refresh keeps showing the profile while it waits: %v", again)
	}
	stateOf(app).armory.wait()
	// Older than six hours: fetched again when opened.
	if _, err := app.DB().NewQuery("UPDATE armory_profiles SET fetchedAt = {:at}").Bind(dbx.Params{"at": ago(7 * time.Hour)}).Execute(); err != nil {
		t.Fatal(err)
	}
	if again := ask(t, app, "GET", armoryPath(id), nil, "", 200); again["state"] != "queued" {
		t.Fatalf("an old profile is not fetched again: %v", again)
	}
	stateOf(app).armory.wait()
	if n := countOf(t, app, "armory_profiles"); n != 1 || stand.requests.Load() != 6 {
		t.Fatalf("%d profiles after %d requests", n, stand.requests.Load())
	}
	// A hidden profile is gone from the armory and never fetched again.
	if _, err := app.DB().NewQuery("UPDATE armory_profiles SET hidden = TRUE, fetchedAt = ''").Execute(); err != nil {
		t.Fatal(err)
	}
	ask(t, app, "GET", armoryPath(id), nil, "", 404)
	// Ids that cannot be PLAYNC's, and servers outside the region, are not asked for.
	ask(t, app, "GET", "/api/odyle/armory/nae/2304/"+id, nil, "", 404)
	ask(t, app, "GET", armoryPath("short"), nil, "", 404)
	if stand.requests.Load() != 6 {
		t.Fatalf("%d requests", stand.requests.Load())
	}
}

func TestArmoryLookupsThatFail(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	// PLAYNC does not list it: not found, and not asked for again for an hour.
	ask(t, app, "GET", armoryPath("missingAAAAAAAAAAAAAAAA="), nil, "", 200)
	stateOf(app).armory.wait()
	ask(t, app, "GET", armoryPath("missingAAAAAAAAAAAAAAAA="), nil, "", 404)
	if stand.requests.Load() != 1 || countOf(t, app, "armory_profiles") != 0 {
		t.Fatalf("%d requests", stand.requests.Load())
	}
	// PLAYNC refuses the server: the lookup failed, and the queue waits before the next.
	ask(t, app, "GET", armoryPath("refusedAAAAAAAAAAAAAAAA="), nil, "", 200)
	stateOf(app).armory.wait()
	failed := ask(t, app, "GET", armoryPath("refusedAAAAAAAAAAAAAAAA="), nil, "", 200)
	if failed["state"] != "failed" || failed["lookupError"] != "PLAYNC refused the lookup for now." || failed["retryAfter"].(float64) < 60 {
		t.Fatalf("refused: %v", failed)
	}
	status := armoryStatus(app)
	if status["failed"] != 1 || status["blockedUntil"] == "" || status["lastError"] != "PLAYNC refused the lookup for now." {
		t.Fatalf("status: %v", status)
	}
	next := ask(t, app, "GET", armoryPath("kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="), nil, "", 200)
	if next["state"] != "queued" || next["wait"].(float64) < 500 {
		t.Fatalf("after a refusal the queue waits: %v", next)
	}
	w := stateOf(app).armory
	w.mu.Lock()
	w.drop()
	w.mu.Unlock()
	w.wait()
}

func TestArmoryQueueLimitsEachAddressAndPauses(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{gate: make(chan struct{})}
	stand.serve(t)
	app := newTestApp(t)
	states := []string{}
	for _, id := range []string{"AAAAAAAAAAAAAAAAAAAAAAA1", "AAAAAAAAAAAAAAAAAAAAAAA2", "AAAAAAAAAAAAAAAAAAAAAAA3", "AAAAAAAAAAAAAAAAAAAAAAA4", "AAAAAAAAAAAAAAAAAAAAAAA5"} {
		states = append(states, ask(t, app, "GET", armoryPath(id), nil, "", 200)["state"].(string))
		// The first is taken off the queue as soon as its lookup starts.
		for i := 0; i < 100 && id == "AAAAAAAAAAAAAAAAAAAAAAA1" && armoryStatus(app)["fetching"] != true; i++ {
			time.Sleep(5 * time.Millisecond)
		}
	}
	if strings.Join(states, ",") != "queued,queued,queued,queued,busy" {
		t.Fatalf("states %v", states)
	}
	if again := ask(t, app, "GET", armoryPath("AAAAAAAAAAAAAAAAAAAAAAA1"), nil, "", 200); again["state"] != "fetching" {
		t.Fatalf("running: %v", again)
	}
	if third := ask(t, app, "GET", armoryPath("AAAAAAAAAAAAAAAAAAAAAAA3"), nil, "", 200); third["position"].(float64) != 2 {
		t.Fatalf("third: %v", third)
	}
	// Paused: nothing more is asked for, the queue is dropped and searches are refused.
	if _, err := writeSettings(app, body{"armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	if paused := ask(t, app, "GET", armoryPath("AAAAAAAAAAAAAAAAAAAAAAA5"), nil, "", 200); paused["state"] != "paused" {
		t.Fatalf("paused: %v", paused)
	}
	ask(t, app, "GET", "/api/odyle/armory/search?name=Ka&server=Lumiel&region=GLOBAL_EU", nil, "", 503)
	close(stand.gate)
	stateOf(app).armory.wait()
	if n := stand.requests.Load(); n != 2 {
		t.Fatalf("%d requests while paused", n)
	}
}

func TestArmorySearchListsExactNamesFirstAndKeepsTheAnswer(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	out := ask(t, app, "GET", "/api/odyle/armory/search?name=Ka&server=Lumiel&region=GLOBAL_EU", nil, "", 200)
	results, _ := out["results"].([]any)
	if len(results) != 2 {
		t.Fatalf("results %v", out)
	}
	exact := results[0].(map[string]any)
	if exact["name"] != "Ka" || exact["characterId"] != "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=" || exact["serverId"].(float64) != 2304 || exact["region"] != "eu" || exact["server"] != "Lumiel" {
		t.Fatalf("exact %v", exact)
	}
	ask(t, app, "GET", "/api/odyle/armory/search?name=ka&server=Lumiel&region=GLOBAL_EU", nil, "", 200)
	if stand.searches.Load() != 1 {
		t.Fatalf("%d searches", stand.searches.Load())
	}
	// North America has two search regions.
	ask(t, app, "GET", "/api/odyle/armory/search?name=Ka&server=Lumiel&region=GLOBAL_NA", nil, "", 200)
	if stand.searches.Load() != 3 {
		t.Fatalf("%d searches", stand.searches.Load())
	}
	ask(t, app, "GET", "/api/odyle/armory/search?name=K&server=Lumiel&region=GLOBAL_EU", nil, "", 400)
	ask(t, app, "GET", "/api/odyle/armory/search?name=Ka%20Ka&server=Lumiel&region=GLOBAL_EU", nil, "", 400)
	ask(t, app, "GET", "/api/odyle/armory/search?name=Ka&server=Atlantis&region=GLOBAL_EU", nil, "", 400)
	servers := ask(t, app, "GET", "/api/odyle/armory/servers", nil, "", 200)
	if regions, _ := servers["regions"].([]any); len(regions) != 5 {
		t.Fatalf("servers %v", servers)
	}
}

func TestArmoryForgetsProfilesNobodyOpened(t *testing.T) {
	app := newTestApp(t)
	keep := func(id string, viewed time.Duration, hidden bool) {
		saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": id, "viewedAt": ago(viewed), "hidden": hidden})
	}
	keep("AAAAAAAAAAAAAAAAAAAAAAA1", 31*24*time.Hour, false)
	keep("AAAAAAAAAAAAAAAAAAAAAAA2", 31*24*time.Hour, true)
	keep("AAAAAAAAAAAAAAAAAAAAAAA3", 29*24*time.Hour, false)
	out, err := cleanArmory(app)
	if err != nil || out.Done != 1 || countOf(t, app, "armory_profiles") != 2 {
		t.Fatalf("%v %v", out, err)
	}
}

func TestArmoryRoutesHaveTheirOwnRateLimits(t *testing.T) {
	app := newTestApp(t)
	rules := app.Settings().RateLimits.Rules
	if len(rules) < 3 || rules[0].Label != "/api/odyle/armory/search" || rules[1].Label != "/api/odyle/armory/" {
		t.Fatalf("rules %v", rules)
	}
	rule, ok := app.Settings().RateLimits.FindRateLimitRule([]string{"GET " + armoryPath("x"), armoryPath("x")})
	if !ok || rule.Label != "/api/odyle/armory/" || rule.MaxRequests != 60 {
		t.Fatalf("rule %v", rule)
	}
}
