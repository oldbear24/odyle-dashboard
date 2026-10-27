package odyle

import (
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/tests"
)

// Places are kept only for accounts that share them, follow the history rules, reach the
// rooms with the character, and disappear when sharing stops.
func TestLocationSharingIsOptInAndForgottenWhenTurnedOff(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player, other := newUser(t, app, "Wanderer"), newUser(t, app, "Stranger")
	session := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	theirSession := saved(t, app, "publisher_sessions", map[string]any{"user": other.Id, "expiresAt": expiry(86400)})
	c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Scout", "server": "Lumiel", "region": "GLOBAL_EU"})
	raw, err := player.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	stranger, err := other.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	auth, theirs := map[string]string{"Authorization": raw}, map[string]string{"Authorization": stranger}
	reuse := func(testing.TB) *tests.TestApp { return app }
	place := func(sessionId, characterId, extra string) string {
		return `{"sessionId":"` + sessionId + `","characterId":"` + characterId + `","adapter":"global-location-v1","map":1110,"x":-83475.7,"y":-33883.7,"z":19698,"heading":-137,"source":"load"` + extra + `}`
	}
	scenarios := func(list ...tests.ApiScenario) {
		for _, s := range list {
			s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
			s.Test(t)
		}
	}
	scenarios(
		tests.ApiScenario{Name: "not shared yet: nothing kept", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(place(session.Id, c.Id, "")), ExpectedStatus: 200, ExpectedContent: []string{`"shared":false`}},
		tests.ApiScenario{Name: "the heartbeat says it is off", Method: http.MethodPost, URL: "/api/odyle/heartbeat", Headers: auth, Body: strings.NewReader(`{"sessionId":"` + session.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"shareLocation":false`}},
		tests.ApiScenario{Name: "sharing takes true or false", Method: http.MethodPost, URL: "/api/odyle/location-sharing", Headers: auth, Body: strings.NewReader(`{"enabled":"yes"}`), ExpectedStatus: 400, ExpectedContent: []string{"Location sharing must be true or false."}},
		tests.ApiScenario{Name: "the owner turns it on", Method: http.MethodPost, URL: "/api/odyle/location-sharing", Headers: auth, Body: strings.NewReader(`{"enabled":true}`), ExpectedStatus: 200, ExpectedContent: []string{`"shareLocation":true`}},
		tests.ApiScenario{Name: "the heartbeat says it is on", Method: http.MethodPost, URL: "/api/odyle/heartbeat", Headers: auth, Body: strings.NewReader(`{"sessionId":"` + session.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"shareLocation":true`}},
		tests.ApiScenario{Name: "another account's character", Method: http.MethodPost, URL: "/api/odyle/location", Headers: theirs, Body: strings.NewReader(place(theirSession.Id, c.Id, "")), ExpectedStatus: 403, ExpectedContent: []string{"This character belongs to another account."}},
		tests.ApiScenario{Name: "an unknown adapter", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(strings.Replace(place(session.Id, c.Id, ""), "global-location-v1", "global-location-v0", 1)), ExpectedStatus: 400, ExpectedContent: []string{"This location adapter is not accepted."}},
		tests.ApiScenario{Name: "a map out of range", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(strings.Replace(place(session.Id, c.Id, ""), `"map":1110`, `"map":0`, 1)), ExpectedStatus: 400, ExpectedContent: []string{"The map must be an integer"}},
		tests.ApiScenario{Name: "a coordinate out of range", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(strings.Replace(place(session.Id, c.Id, ""), `"x":-83475.7`, `"x":2000000`, 1)), ExpectedStatus: 400, ExpectedContent: []string{"Coordinate x must be a number"}},
		tests.ApiScenario{Name: "an unknown source", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(strings.Replace(place(session.Id, c.Id, ""), `"load"`, `"walk"`, 1)), ExpectedStatus: 400, ExpectedContent: []string{"The source must be load, arrival, flight or effect."}},
		tests.ApiScenario{Name: "a load is kept", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(place(session.Id, c.Id, "")), ExpectedStatus: 200, ExpectedContent: []string{`"shared":true`}},
	)
	location := func() map[string]any {
		t.Helper()
		record, err := app.FindRecordById("characters", c.Id)
		if err != nil {
			t.Fatal(err)
		}
		v, _ := parseJSON(record.GetString("location"), "null").(map[string]any)
		return v
	}
	if l := location(); l == nil || l["map"] != float64(1110) || l["heading"] != float64(223) || l["source"] != "load" {
		t.Fatalf("location = %v, want map 1110 heading 223 from the load", l)
	}
	if n := countOf(t, app, "character_locations"); n != 1 {
		t.Fatalf("kept %d places, want 1", n)
	}
	flight := strings.Replace(strings.Replace(place(session.Id, c.Id, ""), `"load"`, `"flight"`, 1), `"heading":-137`, `"heading":null`, 1)
	scenarios(
		tests.ApiScenario{Name: "a flight tick within the minute", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(strings.Replace(flight, `"x":-83475.7`, `"x":-83000`, 1)), ExpectedStatus: 200, ExpectedContent: []string{`"shared":true`}},
	)
	if l := location(); l["source"] != "flight" || l["x"] != float64(-83000) || l["heading"] != nil {
		t.Fatalf("location = %v, want the flight tick", l)
	}
	if n := countOf(t, app, "character_locations"); n != 1 {
		t.Fatalf("a flight tick within the minute was kept: %d places", n)
	}
	scenarios(
		tests.ApiScenario{Name: "a load on another map", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(strings.Replace(place(session.Id, c.Id, ""), `"map":1110`, `"map":600001`, 1)), ExpectedStatus: 200, ExpectedContent: []string{`"shared":true`}},
		tests.ApiScenario{Name: "the owner reads the places", Method: http.MethodGet, URL: "/api/odyle/locations/" + c.Id, Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"shared":true`, `"location":{"map":600001`, `"map":600001`, `"map":1110`, `"source":"load"`}},
		tests.ApiScenario{Name: "a stranger cannot", Method: http.MethodGet, URL: "/api/odyle/locations/" + c.Id, Headers: theirs, ExpectedStatus: 403, ExpectedContent: []string{"This character is not shared with you."}},
		tests.ApiScenario{Name: "the account answer says it is on", Method: http.MethodGet, URL: "/api/odyle/account", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"shareLocation":true`}},
	)
	if n := countOf(t, app, "character_locations"); n != 2 {
		t.Fatalf("kept %d places, want 2", n)
	}
	// Server controls switch the adapter off like a reading adapter.
	if _, err := writeSettings(app, body{"adapters": map[string]any{"extra": []any{}, "disabled": []any{"global-location-v1"}}}); err != nil {
		t.Fatal(err)
	}
	scenarios(tests.ApiScenario{Name: "a switched-off adapter", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(place(session.Id, c.Id, "")), ExpectedStatus: 400, ExpectedContent: []string{"This location adapter is not accepted."}})
	if _, err := writeSettings(app, body{"adapters": map[string]any{"extra": []any{}, "disabled": []any{}}, "readerPaused": true}); err != nil {
		t.Fatal(err)
	}
	scenarios(tests.ApiScenario{Name: "paused readers", Method: http.MethodPost, URL: "/api/odyle/location", Headers: auth, Body: strings.NewReader(place(session.Id, c.Id, "")), ExpectedStatus: 503, ExpectedContent: []string{"Packet readers are paused"}})
	if _, err := writeSettings(app, body{"readerPaused": false}); err != nil {
		t.Fatal(err)
	}
	scenarios(
		tests.ApiScenario{Name: "the owner turns it off", Method: http.MethodPost, URL: "/api/odyle/location-sharing", Headers: auth, Body: strings.NewReader(`{"enabled":false}`), ExpectedStatus: 200, ExpectedContent: []string{`"shareLocation":false`}},
		tests.ApiScenario{Name: "no places while off", Method: http.MethodGet, URL: "/api/odyle/locations/" + c.Id, Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"shared":false`, `"location":null`, `"locations":[]`}},
	)
	if l := location(); l != nil {
		t.Fatalf("location after turning sharing off = %v, want none", l)
	}
	if n := countOf(t, app, "character_locations"); n != 0 {
		t.Fatalf("%d places left after turning sharing off", n)
	}
}

// The expiry job deletes places older than 30 days.
func TestOldPlacesExpire(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Wanderer")
	c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Scout", "server": "Lumiel", "region": "GLOBAL_EU"})
	old := saved(t, app, "character_locations", map[string]any{"character": c.Id, "map": 1110, "x": 1, "y": 2, "z": 3, "source": "load"})
	saved(t, app, "character_locations", map[string]any{"character": c.Id, "map": 1110, "x": 4, "y": 5, "z": 6, "source": "load"})
	if _, err := app.DB().NewQuery("UPDATE character_locations SET created = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": stamp(time.Now().Add(-31 * 24 * time.Hour)), "id": old.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	if _, err := cleanup(app); err != nil {
		t.Fatal(err)
	}
	if n := countOf(t, app, "character_locations"); n != 1 {
		t.Fatalf("%d places after the expiry job, want 1", n)
	}
}

// Superusers name map ids; ids seen without a name are listed for them.
func TestMapsAreNamedBySuperusers(t *testing.T) {
	for _, bad := range []any{"Altgard", []any{map[string]any{"id": float64(0), "name": "x"}}, []any{map[string]any{"id": float64(1110), "name": "a"}, map[string]any{"id": float64(1110), "name": "b"}}, []any{map[string]any{"id": float64(1110), "name": "a", "thgl": "../evil"}}, []any{map[string]any{"id": float64(1110), "name": "a", "thgl": "<b>Altgard</b>"}}, []any{map[string]any{"id": float64(1110), "name": "a", "thgl": strings.Repeat("x", 121)}}, []any{map[string]any{"id": float64(1110), "name": strings.Repeat("x", 61)}}} {
		if _, err := checkMaps(bad); err == nil {
			t.Errorf("checkMaps(%v) accepted", bad)
		}
	}
	maps, err := checkMaps([]any{map[string]any{"id": float64(1110), "name": "  Altgard  ", "thgl": "Altgard"}, map[string]any{"id": float64(600001), "name": "", "thgl": "Fire Temple"}})
	if err != nil || len(maps) != 2 || maps[0].Name != "Altgard" || maps[1].Thgl != "Fire Temple" {
		t.Fatalf("checkMaps = %v, %v", maps, err)
	}
	app := newTestApp(t)
	player := newUser(t, app, "Wanderer")
	c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Scout", "server": "Lumiel", "region": "GLOBAL_EU"})
	saved(t, app, "character_locations", map[string]any{"character": c.Id, "map": 1110, "source": "load"})
	saved(t, app, "character_locations", map[string]any{"character": c.Id, "map": 600001, "source": "load"})
	if _, err := writeSettings(app, body{"maps": []any{map[string]any{"id": float64(1110), "name": "Altgard", "thgl": "Altgard"}}}); err != nil {
		t.Fatal(err)
	}
	if got := readSettings(app).Maps; len(got) != 1 || got[0].Name != "Altgard" {
		t.Fatalf("saved maps = %v", got)
	}
	unnamed := unnamedMaps(app, readSettings(app).Maps)
	if len(unnamed) != 1 || unnamed[0].(map[string]any)["id"] != int64(600001) {
		t.Fatalf("unnamed maps = %v, want only 600001", unnamed)
	}
}

// TH.GL's whole map list passes the check, and what a superuser leaves out is linked from it: a
// map named after a place TH.GL lists gets its TH.GL map, and one linked to a TH.GL map of one
// place gets that place's name. A superuser's own choice stays.
func TestMapsLinkTheirTHGLMapsByPlace(t *testing.T) {
	for _, name := range thglMaps {
		if !thglMap.MatchString(name) {
			t.Errorf("TH.GL map %q fails the check", name)
		}
		for _, place := range thglPlaces(name) {
			if length(place) > 60 {
				t.Errorf("place %q of %q is too long for a name", place, name)
			}
		}
	}
	if len(thglByName) != len(thglMaps) {
		t.Errorf("%d TH.GL maps, %d names", len(thglMaps), len(thglByName))
	}
	if got := thglPlaces("Nightmare Altar (Easy) / Nightmare Altar (Normal) (+4)"); !slices.Equal(got, []string{"Nightmare Altar (Easy)", "Nightmare Altar", "Nightmare Altar (Normal)"}) {
		t.Errorf("places = %q", got)
	}
	entry := func(id int, name, thgl string) any {
		return map[string]any{"id": float64(id), "name": name, "thgl": thgl}
	}
	maps, err := checkMaps([]any{entry(1, "altgard", ""), entry(2, "Valka’s  Nest", ""), entry(3, "Nightmare Altar", ""), entry(4, "", "fire temple arena"), entry(5, "", "Herb Cave / Valka's Nest (+3)"), entry(6, "Our camp", ""), entry(7, "Altgard", "Morheim"), entry(8, "", "A Map TH.GL Adds Later"), entry(9, "Fire Temple", "")})
	want := []gameMap{{1, "altgard", "Altgard"}, {2, "Valka’s Nest", "Herb Cave / Valka's Nest (+3)"}, {3, "Nightmare Altar", "Nightmare Altar (Easy) / Nightmare Altar (Normal) (+4)"}, {4, "Fire Temple Arena", "Fire Temple Arena"},
		{5, "", "Herb Cave / Valka's Nest (+3)"}, {6, "Our camp", ""}, {7, "Altgard", "Morheim"}, {8, "", "A Map TH.GL Adds Later"}, {9, "Fire Temple", "Fire Temple"}}
	if err != nil || !slices.Equal(maps, want) {
		t.Fatalf("checkMaps = %v, %v\nwant %v", maps, err, want)
	}
	// Maps saved before this list (or under Collections → odyle_settings) are linked when read.
	app := newTestApp(t)
	record := findSettings(app)
	record.Set("maps", []any{entry(1110, "Altgard", "")})
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if got := readSettings(app).Maps; len(got) != 1 || got[0].Thgl != "Altgard" {
		t.Fatalf("read maps = %v, want Altgard linked", got)
	}
}
