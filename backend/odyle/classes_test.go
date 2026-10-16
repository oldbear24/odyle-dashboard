package odyle

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// classStand is PLAYNC's search listing each name with the given id, class id and level.
func classStand(t *testing.T, hits map[string]map[string]any) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/search" {
			name := r.URL.Query().Get("keyword")
			hit := map[string]any{"name": name, "serverId": 2304, "race": 2, "profileImageUrl": "/images"}
			for k, v := range hits[name] {
				hit[k] = v
			}
			json.NewEncoder(w).Encode(map[string]any{"list": []any{hit}})
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write(onePixel)
	}))
	t.Cleanup(server.Close)
	t.Setenv("PLAYNC_SEARCH_URL", server.URL+"/search")
	t.Setenv("PLAYNC_IMAGE_URL", server.URL)
}

var onePixel = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\xdac\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82")

func characterRecord(t *testing.T, app core.App, id string) *core.Record {
	t.Helper()
	c, err := app.FindRecordById("characters", id)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestTheDailyLookupKeepsClassLevelAndTheOfficialId(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Classy")
	const official = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	classStand(t, map[string]map[string]any{
		"Chanty": {"characterId": url.QueryEscape(official), "pcId": 36, "level": 45},
		"Rangy":  {"characterId": "rangerId1234", "pcId": 15, "level": 12},
		"Oddy":   {"characterId": "../not an id", "pcId": 9, "level": 30},
	})
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	chanty, rangy, oddy := newGameCharacter(t, app, user.Id, "Chanty"), newGameCharacter(t, app, user.Id, "Rangy"), newGameCharacter(t, app, user.Id, "Oddy")
	for _, id := range []string{chanty, rangy, oddy} {
		if err := gamePortrait(app, id); err != nil {
			t.Fatal(err)
		}
	}
	// The official id is kept decoded, with the search region and server id that find its profile;
	// the class is named from what PLAYNC's pages named it.
	c := characterRecord(t, app, chanty)
	if c.GetString("officialId") != official || c.GetString("officialRegion") != "eu" || c.GetInt("officialServerId") != 2304 || c.GetInt("level") != 45 || c.GetInt("classId") != 36 || c.GetString("className") != "Chanter" || c.GetString("portrait") == "" {
		t.Fatalf("chanty: %v", c.PublicExport())
	}
	// A class id never named yet stays unnamed; an id that cannot be PLAYNC's is left out.
	if r := characterRecord(t, app, rangy); r.GetInt("classId") != 15 || r.GetString("className") != "" || r.GetInt("level") != 12 {
		t.Fatalf("rangy: %v", r.PublicExport())
	}
	if o := characterRecord(t, app, oddy); o.GetString("officialId") != "" || o.GetString("className") != "Templar" || o.GetInt("level") != 30 {
		t.Fatalf("oddy: %v", o.PublicExport())
	}
	// PLAYNC's page names class 15: every character with it is named at once.
	if err := learnClass(app, 15, "Ranger"); err != nil {
		t.Fatal(err)
	}
	if r := characterRecord(t, app, rangy); r.GetString("className") != "Ranger" {
		t.Fatalf("rangy after learning: %v", r.PublicExport())
	}
	if n, err := app.CountRecords("game_classes", dbx.HashExp{"pcId": 15}); err != nil || n != 1 {
		t.Fatalf("%d classes 15, %v", n, err)
	}
	// The next lookup keeps the level as PLAYNC lists it then.
	classStand(t, map[string]map[string]any{"Chanty": {"characterId": url.QueryEscape(official), "pcId": 36, "level": 46}})
	if err := gamePortrait(app, chanty); err != nil {
		t.Fatal(err)
	}
	if c := characterRecord(t, app, chanty); c.GetInt("level") != 46 || c.GetString("className") != "Chanter" {
		t.Fatalf("chanty a day later: %v", c.PublicExport())
	}
}

func TestTheArmoryNamesTheClassesItReads(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	user := newUser(t, app, "Unnamed")
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	// A class id the seed did not know yet (as 36 is here, removed first).
	if _, err := app.DB().NewQuery("DELETE FROM game_classes WHERE pcId = 36").Execute(); err != nil {
		t.Fatal(err)
	}
	id := saved(t, app, "characters", map[string]any{"user": user.Id, "characterName": "Unnamed", "server": "Lumiel", "region": "GLOBAL_EU", "classId": 36}).Id
	ask(t, app, "GET", armoryPath("kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="), nil, "", 200)
	stateOf(app).armory.wait()
	if c := characterRecord(t, app, id); c.GetString("className") != "Chanter" {
		t.Fatalf("not named: %v", c.PublicExport())
	}
	if name := classNameOf(app, 36); name != "Chanter" {
		t.Fatalf("class 36 is %q", name)
	}
}

func TestEveryClassIdSeededHasItsClass(t *testing.T) {
	app := newTestApp(t)
	counts := map[string]int{}
	records, err := app.FindAllRecords("game_classes")
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range records {
		counts[r.GetString("name")]++
	}
	for _, name := range []string{"Gladiator", "Templar", "Ranger", "Assassin", "Spiritmaster", "Sorcerer", "Cleric", "Chanter"} {
		if counts[name] < 3 {
			t.Fatalf("%s has %d class ids: %v", name, counts[name], counts)
		}
	}
	if len(records) != 30 {
		t.Fatalf("%d class ids", len(records))
	}
}
