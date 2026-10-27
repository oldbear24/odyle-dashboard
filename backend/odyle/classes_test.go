package odyle

import (
	"bytes"
	"encoding/json"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
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

// Each class's emblem comes from PLAYNC's character pages: read once a lookup meets a class
// without one, and nightly. Profiles, searches and rooms name it, and it stays with the
// armory's images.
func TestClassIconsComeFromPLAYNC(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	if first := ask(t, app, "GET", armoryPath(id), nil, "", 200); first["classIcon"] != "" {
		t.Fatalf("no profile yet: %v", first)
	}
	stateOf(app).armory.wait()
	icons := classIcons(app)
	if icons["Chanter"] != "class_icon_chanter.png" || icons["Spiritmaster"] != "class_icon_elementalist.png" || icons["Ranger"] != "" || len(icons) != 2 || stand.classLists.Load() != 1 {
		t.Fatalf("icons %v after %d lists", icons, stand.classLists.Load())
	}
	// Class ids PLAYNC lists are named, those the seed lacked too; a bad name is left out.
	if classNameOf(app, 15) != "Ranger" || classNameOf(app, 99) != "" {
		t.Fatalf("15 is %q, 99 is %q", classNameOf(app, 15), classNameOf(app, 99))
	}
	emblem, _ := fetch(t, app, "/api/odyle/armory-images/class_icon_chanter.png", 200)
	if config, err := png.DecodeConfig(bytes.NewReader(emblem)); err != nil || config.Width != iconSize {
		t.Fatalf("emblem %v %v", config, err)
	}
	if kept := ask(t, app, "GET", armoryPath(id), nil, "", 200); kept["classIcon"] != "class_icon_chanter.png" {
		t.Fatalf("profile: %v", kept["classIcon"])
	}
	// A class with an emblem asks for no list again.
	if _, err := app.DB().NewQuery("UPDATE armory_profiles SET fetchedAt = {:at}").Bind(dbx.Params{"at": ago(7 * time.Hour)}).Execute(); err != nil {
		t.Fatal(err)
	}
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	stateOf(app).armory.wait()
	if stand.classLists.Load() != 1 {
		t.Fatalf("%d lists", stand.classLists.Load())
	}
	// Searches name each hit's class by its class id.
	results, _ := ask(t, app, "GET", "/api/odyle/armory/search?name=Ka&server=Lumiel&region=GLOBAL_EU", nil, "", 200)["results"].([]any)
	if hit := results[0].(map[string]any); hit["class"] != "Chanter" || hit["classIcon"] != "class_icon_chanter.png" || results[1].(map[string]any)["class"] != "" {
		t.Fatalf("results %v", results)
	}
	// Rooms carry the emblems by class name.
	user := newUser(t, app, "Ka")
	rooms := ask(t, app, "GET", "/api/odyle/rooms", tokenOf(t, user), "", 200)
	if listed, _ := rooms["classIcons"].(map[string]any); listed["Spiritmaster"] != "class_icon_elementalist.png" || len(listed) != 2 {
		t.Fatalf("rooms %v", rooms["classIcons"])
	}
	// Nightly: the emblems outlive the clean-up, and the list is read again (the Ranger's
	// emblem tried again); paused, PLAYNC is not asked.
	for _, name := range []string{"class_icon_chanter.png", "class_icon_elementalist.png"} {
		past := time.Now().Add(-2 * time.Hour)
		os.Chtimes(filepath.Join(imageDir(app), name), past, past)
	}
	before := stand.classIcons.Load()
	if _, err := armoryNight(app); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"class_icon_chanter.png", "class_icon_elementalist.png"} {
		if _, err := os.Stat(filepath.Join(imageDir(app), name)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if stand.classLists.Load() != 2 || stand.classIcons.Load()-before != 1 {
		t.Fatalf("%d lists, %d emblems", stand.classLists.Load(), stand.classIcons.Load()-before)
	}
	if _, err := writeSettings(app, body{"armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	if _, err := armoryNight(app); err != nil || stand.classLists.Load() != 2 {
		t.Fatalf("paused: %v, %d lists", err, stand.classLists.Load())
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
