package odyle

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// A build's plan as the dashboard sends it.
const samplePlan = `{"gear":[{"slot":"MainHand","name":" Rod A ","grade":"Unique","enchant":15,"exceed":2,"stones":[{"name":"Attack","value":"+10","grade":"Unique"}],"gods":[],"sub":[{"name":"Combat Speed","value":"13%"}],"skills":[{"name":"Bolt","level":2}]},` +
	`{"slot":"Pet","name":"Pagati","grade":"","enchant":0,"exceed":0,"level":3,"stones":[],"gods":[],"sub":[],"skills":[]}],` +
	`"skills":[{"name":"Bolt","level":13,"bar":true},{"name":"Heal","level":9,"bar":false}],"boards":[{"id":71,"nodes":["8,8","3,3"]}],"notes":"Line one  \n\n\n\nLine two","from":{"region":"eu","serverId":2304,"characterId":"kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=","name":"Kai"}}`

// A player makes a build, changes it, shares it and stops sharing it; anyone with the link opens it
// while it is shared, its owner learns it is theirs, a signed-in reader copies it, and nobody else
// reads, changes or deletes it.
func TestBuildsAreKeptSharedCopiedAndDeleted(t *testing.T) {
	app := newTestApp(t)
	lumina, other := newUser(t, app, "Lumina"), newUser(t, app, "Other")
	mine, theirs := tokenOf(t, lumina), tokenOf(t, other)

	made := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"name":"  Boss   build ","class":"Chanter","plan":`+samplePlan+`}`, 200)["build"].(map[string]any)
	id := made["id"].(string)
	plan := made["plan"].(map[string]any)
	if made["name"] != "Boss build" || made["class"] != "Chanter" || made["share"] != "" || plan["notes"] != "Line one\n\nLine two" ||
		plan["gear"].([]any)[0].(map[string]any)["name"] != "Rod A" || plan["from"].(map[string]any)["name"] != "Kai" {
		t.Fatalf("made %v", made)
	}
	// An empty build of a class.
	empty := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"name":"Empty","class":"Templar"}`, 200)["build"].(map[string]any)
	if p := empty["plan"].(map[string]any); len(p["gear"].([]any)) != 0 || len(p["boards"].([]any)) != 0 || p["from"] != nil {
		t.Fatalf("empty %v", empty)
	}

	list := ask(t, app, http.MethodGet, "/api/odyle/builds", mine, "", 200)
	builds := list["builds"].([]any)
	if len(builds) != 2 || list["limit"] != float64(buildLimit) {
		t.Fatalf("list %v", list)
	}
	var boss map[string]any
	for _, b := range builds {
		if b.(map[string]any)["id"] == id {
			boss = b.(map[string]any)
		}
	}
	if boss == nil || boss["gear"] != float64(2) || boss["nodes"] != float64(2) || boss["bar"] != float64(1) || boss["plan"] != nil || boss["from"].(map[string]any)["serverId"] != float64(2304) {
		t.Fatalf("summary %v", boss)
	}
	if others := ask(t, app, http.MethodGet, "/api/odyle/builds", theirs, "", 200)["builds"].([]any); len(others) != 0 {
		t.Fatalf("another account lists %v", others)
	}
	ask(t, app, http.MethodGet, "/api/odyle/builds", nil, "", 401)

	// Only its owner reads, changes and deletes it.
	if got := ask(t, app, http.MethodGet, "/api/odyle/builds/"+id, mine, "", 200)["build"].(map[string]any); got["plan"].(map[string]any)["skills"].([]any)[0].(map[string]any)["level"] != float64(13) {
		t.Fatalf("got %v", got)
	}
	ask(t, app, http.MethodGet, "/api/odyle/builds/"+id, theirs, "", 403)
	ask(t, app, http.MethodPost, "/api/odyle/build", theirs, `{"id":"`+id+`","name":"Mine now"}`, 403)
	ask(t, app, http.MethodPost, "/api/odyle/build", theirs, `{"id":"`+id+`","remove":true}`, 403)
	ask(t, app, http.MethodGet, "/api/odyle/builds/nonexistent0000", mine, "", 404)

	renamed := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"id":"`+id+`","name":"Raid build","plan":{"gear":[],"skills":[],"boards":[],"notes":""}}`, 200)["build"].(map[string]any)
	if renamed["name"] != "Raid build" || len(renamed["plan"].(map[string]any)["gear"].([]any)) != 0 || renamed["class"] != "Chanter" {
		t.Fatalf("renamed %v", renamed)
	}
	ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"id":"`+id+`"}`, 400)

	// Shared: a code anyone with the link opens; sharing again keeps it.
	shared := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"id":"`+id+`","share":true}`, 200)["build"].(map[string]any)
	code := shared["share"].(string)
	if !buildShareCode.MatchString(code) {
		t.Fatalf("code %q", code)
	}
	if again := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"id":"`+id+`","share":true}`, 200)["build"].(map[string]any); again["share"] != code {
		t.Fatalf("a new code: %v", again["share"])
	}
	open := ask(t, app, http.MethodGet, "/api/odyle/builds/shared/"+code, nil, "", 200)["build"].(map[string]any)
	if open["name"] != "Raid build" || open["class"] != "Chanter" || open["mine"] != nil || open["id"] != nil || open["user"] != nil {
		t.Fatalf("open %v", open)
	}
	if own := ask(t, app, http.MethodGet, "/api/odyle/builds/shared/"+code, mine, "", 200)["build"].(map[string]any); own["mine"] != true || own["id"] != id {
		t.Fatalf("own %v", own)
	}
	if seen := ask(t, app, http.MethodGet, "/api/odyle/builds/shared/"+code, theirs, "", 200)["build"].(map[string]any); seen["mine"] != nil {
		t.Fatalf("seen %v", seen)
	}
	copied := ask(t, app, http.MethodPost, "/api/odyle/build", theirs, `{"copy":"`+code+`"}`, 200)["build"].(map[string]any)
	if copied["id"] == id || copied["name"] != "Raid build" || copied["class"] != "Chanter" || copied["share"] != "" {
		t.Fatalf("copied %v", copied)
	}
	named := ask(t, app, http.MethodPost, "/api/odyle/build", theirs, `{"copy":"`+code+`","name":"My raid"}`, 200)["build"].(map[string]any)
	if named["name"] != "My raid" {
		t.Fatalf("named %v", named)
	}

	// Stopped: the link ends; shared again, a new link.
	ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"id":"`+id+`","share":false}`, 200)
	ask(t, app, http.MethodGet, "/api/odyle/builds/shared/"+code, nil, "", 404)
	ask(t, app, http.MethodPost, "/api/odyle/build", theirs, `{"copy":"`+code+`"}`, 404)
	ask(t, app, http.MethodGet, "/api/odyle/builds/shared/not-a-code", nil, "", 404)
	if fresh := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"id":"`+id+`","share":true}`, 200)["build"].(map[string]any); fresh["share"] == code || fresh["share"] == "" {
		t.Fatalf("shared again %v", fresh["share"])
	}

	// The data download lists the builds without their links' codes.
	export := ask(t, app, http.MethodGet, "/api/odyle/export", mine, "", 200)
	exported := export["builds"].([]any)
	if len(exported) != 2 {
		t.Fatalf("exported %v", exported)
	}
	raw, _ := json.Marshal(exported)
	if !strings.Contains(string(raw), `"shared":true`) || strings.Contains(string(raw), `"share"`) {
		t.Fatalf("export %s", raw)
	}

	if removed := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"id":"`+id+`","remove":true}`, 200); removed["removed"] != id {
		t.Fatalf("removed %v", removed)
	}
	ask(t, app, http.MethodGet, "/api/odyle/builds/"+id, mine, "", 404)

	// Deleting the account deletes its builds.
	if err := app.Delete(other); err != nil {
		t.Fatal(err)
	}
	if n := countOf(t, app, "builds"); n != 1 {
		t.Fatalf("%d builds left", n)
	}
}

// A player copies their own build by its id, to try a variant: the copy is private, keeps the plan
// and the profile it started from, and takes the name sent. Another account's build is copied only
// through its link, never by its id.
func TestBuildsAreCopiedByTheirPlayer(t *testing.T) {
	app := newTestApp(t)
	lumina, other := newUser(t, app, "Lumina"), newUser(t, app, "Other")
	mine, theirs := tokenOf(t, lumina), tokenOf(t, other)
	made := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"name":"Boss build","class":"Chanter","plan":`+samplePlan+`}`, 200)["build"].(map[string]any)
	id := made["id"].(string)
	ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"id":"`+id+`","share":true}`, 200)

	copied := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"copy":"`+id+`","name":"Boss build (copy)"}`, 200)["build"].(map[string]any)
	plan := copied["plan"].(map[string]any)
	if copied["id"] == id || copied["name"] != "Boss build (copy)" || copied["class"] != "Chanter" || copied["share"] != "" ||
		len(plan["gear"].([]any)) != 2 || plan["notes"] != "Line one\n\nLine two" || plan["from"].(map[string]any)["name"] != "Kai" {
		t.Fatalf("copied %v", copied)
	}
	if kept := ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"copy":"`+id+`"}`, 200)["build"].(map[string]any); kept["name"] != "Boss build" {
		t.Fatalf("kept %v", kept)
	}
	ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"copy":"`+id+`","name":"`+strings.Repeat("b", 61)+`"}`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/build", theirs, `{"copy":"`+id+`"}`, 403)
	ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"copy":"nonexistent0000"}`, 404)
	ask(t, app, http.MethodPost, "/api/odyle/build", mine, `{"copy":"not a build"}`, 404)
	ask(t, app, http.MethodPost, "/api/odyle/build", nil, `{"copy":"`+id+`"}`, 401)
	if n := len(ask(t, app, http.MethodGet, "/api/odyle/builds", mine, "", 200)["builds"].([]any)); n != 3 {
		t.Fatalf("%d builds", n)
	}
	if n := len(ask(t, app, http.MethodGet, "/api/odyle/builds", theirs, "", 200)["builds"].([]any)); n != 0 {
		t.Fatalf("another account has %d builds", n)
	}
}

// A plan holds only what a build can: known slots once each, names within limits, levels within
// range, nodes as row and column, notes up to 2,000 characters and nothing else; a name and a
// class are required, and an account keeps up to 50 builds.
func TestBuildPlansAreChecked(t *testing.T) {
	app := newTestApp(t)
	auth := tokenOf(t, newUser(t, app, "Lumina"))
	for _, plan := range []string{
		`{"gear":[{"slot":"Nose","name":"Ring"}]}`,
		`{"gear":[{"slot":"Ring1","name":"A"},{"slot":"Ring1","name":"B"}]}`,
		`{"gear":[{"slot":"Ring1","name":"   "}]}`,
		`{"gear":[{"slot":"Ring1","name":"A","enchant":31}]}`,
		`{"gear":[{"slot":"Ring1","name":"A","enchant":1.5}]}`,
		`{"gear":[{"slot":"Ring1","name":"A","grade":"<b>"}]}`,
		`{"gear":[{"slot":"Ring1","name":"A","stones":[{"name":"","grade":"Rare"}]}]}`,
		`{"skills":[{"name":"Bolt","level":3},{"name":"Bolt","level":4}]}`,
		`{"skills":[{"name":"Bolt","level":51}]}`,
		`{"boards":[{"id":71,"nodes":["8;8"]}]}`,
		`{"boards":[{"id":71,"nodes":["31,1"]}]}`,
		`{"boards":[{"id":71,"nodes":["1,1","1,1"]}]}`,
		`{"boards":[{"id":0,"nodes":[]}]}`,
		`{"from":{"region":"xx","serverId":2304,"characterId":"kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4=","name":"Kai"}}`,
		`{"extra":true}`,
		`[]`,
		`"plan"`,
		`null`,
	} {
		out := ask(t, app, http.MethodPost, "/api/odyle/build", auth, `{"name":"A","class":"Chanter","plan":`+plan+`}`, 400)
		if out["message"] != errPlan.Error() {
			t.Fatalf("%s: %v", plan, out)
		}
	}
	notes := strings.Repeat("a", 2001)
	ask(t, app, http.MethodPost, "/api/odyle/build", auth, `{"name":"A","class":"Chanter","plan":{"notes":"`+notes+`"}}`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/build", auth, `{"class":"Chanter"}`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/build", auth, `{"name":"`+strings.Repeat("b", 61)+`","class":"Chanter"}`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/build", auth, `{"name":"A","class":"<script>"}`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/build", auth, `{"name":"A"}`, 400)
	for n := 0; n < buildLimit; n++ {
		ask(t, app, http.MethodPost, "/api/odyle/build", auth, fmt.Sprintf(`{"name":"Build %d","class":"Chanter"}`, n), 200)
	}
	if full := ask(t, app, http.MethodPost, "/api/odyle/build", auth, `{"name":"One more","class":"Chanter"}`, 400); full["message"] != "You can keep up to 50 builds. Delete one first." {
		t.Fatalf("full %v", full)
	}
}

// classProfile keeps a full profile of a class in the armory with its row among the top players,
// as a lookup would.
func classProfile(t *testing.T, app core.App, n int, class string, fetched time.Time, p armoryProfile, hidden bool) {
	t.Helper()
	id := fmt.Sprintf("BBBBBBBBBBBBBBBBBBBBB%03d", n)
	p.Version, p.Class, p.Name = armoryVersion, class, fmt.Sprintf("Kept%d", n)
	saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": id, "name": p.Name, "fetchedAt": fetched, "viewedAt": time.Now(), "profile": p, "hidden": hidden})
	saved(t, app, "armory_ranks", map[string]any{"region": "eu", "serverId": 2304, "characterId": id, "name": p.Name, "class": class, "level": 45, "combatPower": 100000 + n, "itemLevel": 1500, "checkedAt": now(),
		"builtAt": now(), "build": slimmed(p), "hidden": hidden})
}

// A class's catalog gathers what the armory keeps of the class: every node of its boards from
// several characters (all closed), its skills with the highest level seen and how many keep them
// on their bars, and per slot the items worn with their stats at no enchantment and what a level
// adds, the stones, theostones, rolled stats and raised skills; hidden characters and other
// classes left out. It is kept for everyone a while.
func TestBuildCatalogGathersWhatTheArmoryKeepsOfAClass(t *testing.T) {
	app := newTestApp(t)
	rod := func(enchant, exceed int64, attack, extra string, stone armoryStone, roll string) armoryGear {
		return armoryGear{Slot: "MainHand", Name: "Rod A", Grade: "Unique", Enchant: enchant, Exceed: exceed, Icon: "rod.png", Detail: &armoryItem{
			Category: "Orb", Kind: "Weapon", ItemLevel: 102, MaxEnchant: 15, MaxExceed: 5, StoneSlots: 4, GodSlots: 1, SubCount: 5, Sources: []string{"Crafting"},
			Main:      []armoryLine{{Name: "Attack", Min: "315", Value: attack, Extra: extra}, {Name: "Attack", Value: "50", Exceed: true, Extra: fmt.Sprint(10 * exceed)}},
			Sub:       []armoryLine{{Name: "Combat Speed", Value: roll}},
			SubSkills: []armorySubSkill{{Name: "Bolt", Level: 2, Icon: "bolt.png"}},
			Stones:    []armoryStone{stone}, GodStones: []armoryStone{{Name: "Fury", Grade: "Epic", Desc: "Hits harder", Icon: "fury.png"}},
			Set: &armorySet{Name: "Primal Vigor", Equipped: 1, Items: []armorySetItem{{Name: "Rod A", Grade: "Unique", Equipped: true}, {Name: "Orb B", Grade: "Unique"}}, Bonuses: []armorySetBonus{{Count: 2, Effects: []string{"Attack +50"}}}},
		}}
	}
	at := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	first := armoryProfile{
		Gear: []armoryGear{rod(15, 2, "630", "150", armoryStone{Name: "Attack", Value: "+10", Grade: "Unique", Icon: "atk.png"}, "13%"),
			{Slot: "Earring1", Name: "Ear X", Grade: "Legend"}, {Slot: "Earring2", Name: "Ear X", Grade: "Legend"}, {Slot: "Pet", Name: "Pagati", Level: 3}},
		Skills: []armorySkill{{Name: "Bolt", Category: "Active", Level: 13, NeedLevel: 1, Equipped: true, Icon: "bolt.png"}, {Name: "Heal", Category: "Passive", Level: 5, NeedLevel: 10}},
		Boards: []armoryBoard{{Id: 71, Name: "Nezekan", Open: 2, Total: 40, Icon: "nez.png", Nodes: []armoryNode{
			{Row: 8, Col: 8, Grade: "None", Type: "Start", Name: "Nezekan - Start", Open: true}, {Row: 3, Col: 3, Grade: "Unique", Type: "Stat", Open: true, Effect: "Combat Speed +1.5%"}, {Row: 1, Col: 1, Type: "None"}}},
			{Id: 72, Name: "Zikel", Open: 0, Total: 30}},
	}
	second := armoryProfile{
		Gear:   []armoryGear{rod(10, 0, "630", "100", armoryStone{Name: "Attack", Value: "+10", Grade: "Unique"}, "11%")},
		Skills: []armorySkill{{Name: "Bolt", Category: "Active", Level: 15, NeedLevel: 1, Equipped: true}, {Name: "Heal", Category: "Passive", Level: 9, NeedLevel: 10, Equipped: true}},
		Boards: []armoryBoard{{Id: 71, Name: "Nezekan", Open: 1, Total: 40, Nodes: []armoryNode{{Row: 3, Col: 3, Grade: "Rare", Type: "Stat", Effect: "Other"}, {Row: 4, Col: 5, Grade: "Rare", Type: "SkillLevel", Effect: "Bolt +1", Open: true}}}},
	}
	classProfile(t, app, 1, "Chanter", at, first, false)
	classProfile(t, app, 2, "Chanter", at.Add(-time.Hour), second, false)
	classProfile(t, app, 3, "Chanter", at.Add(time.Hour), armoryProfile{Gear: []armoryGear{{Slot: "MainHand", Name: "Hidden Rod", Grade: "Mythic"}}}, true)
	classProfile(t, app, 4, "Cleric", at, armoryProfile{Gear: []armoryGear{{Slot: "MainHand", Name: "Mace", Grade: "Epic"}}}, false)
	// A character the armory knows only from the scout's build.
	rankOf(t, app, 5, "Chanter", 200000, true, nil)

	catalog := ask(t, app, http.MethodGet, "/api/odyle/armory/catalog/Chanter", nil, "", 200)
	raw, _ := json.Marshal(catalog)
	var c buildCatalog
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if c.Class != "Chanter" || c.Characters != 3 || strings.Contains(string(raw), "Hidden Rod") || strings.Contains(string(raw), "Mace") {
		t.Fatalf("catalog %s", raw)
	}
	if len(c.Boards) != 2 || c.Boards[0].Id != 71 || c.Boards[0].Icon != "nez.png" || c.Boards[0].Total != 40 || len(c.Boards[0].Nodes) != 3 {
		t.Fatalf("boards %+v", c.Boards)
	}
	for _, n := range c.Boards[0].Nodes {
		if n.Open {
			t.Fatalf("an open node %+v", n)
		}
	}
	// The newer profile's node wins its cell; a cell only the older one knows comes from it.
	if n := c.Boards[0].Nodes[0]; n.Row != 3 || n.Col != 3 || n.Grade != "Unique" || n.Effect != "Combat Speed +1.5%" {
		t.Fatalf("first node %+v", n)
	}
	if n := c.Boards[0].Nodes[1]; n.Row != 4 || n.Col != 5 || n.Effect != "Bolt +1" || n.Type != "SkillLevel" {
		t.Fatalf("second node %+v", n)
	}
	if len(c.Skills) != 2 || c.Skills[0] != (catalogSkill{Name: "Bolt", Category: "Active", Icon: "bolt.png", NeedLevel: 1, MaxLevel: 15, Bar: 2}) || c.Skills[1].MaxLevel != 9 || c.Skills[1].Bar != 1 {
		t.Fatalf("skills %+v", c.Skills)
	}
	slots := []string{}
	for _, s := range c.Slots {
		slots = append(slots, s.Slot)
	}
	if strings.Join(slots, ",") != "MainHand,Earring,Pet" {
		t.Fatalf("slots %v", slots)
	}
	main := c.Slots[0]
	if len(main.Items) != 2 || main.Items[0].Name != "Rod A" || main.Items[1].Name != "Rod" {
		t.Fatalf("items %+v", main.Items)
	}
	item := main.Items[0]
	if item.Count != 2 || item.ItemLevel != 102 || item.MaxEnchant != 15 || item.MaxExceed != 5 || item.StoneSlots != 4 || item.GodSlots != 1 || item.SubCount != 5 || item.Category != "Orb" || item.Sources[0] != "Crafting" {
		t.Fatalf("item %+v", item)
	}
	if len(item.Main) != 1 || item.Main[0] != (catalogStat{Name: "Attack", Value: 630, Min: 315, PerEnchant: 10}) {
		t.Fatalf("main %+v", item.Main)
	}
	if len(item.Exceed) != 1 || item.Exceed[0].PerLevel != 10 {
		t.Fatalf("exceed %+v", item.Exceed)
	}
	if item.Set == nil || item.Set.Name != "Primal Vigor" || len(item.Set.Items) != 2 || item.Set.Items[0].Equipped || len(item.Set.Bonuses) != 1 {
		t.Fatalf("set %+v", item.Set)
	}
	if len(main.Stones) != 1 || main.Stones[0] != (catalogStone{Name: "Attack", Value: "+10", Grade: "Unique", Icon: "atk.png", Count: 2}) {
		t.Fatalf("stones %+v", main.Stones)
	}
	if len(main.Gods) != 1 || main.Gods[0].Desc != "Hits harder" || main.Gods[0].Count != 2 {
		t.Fatalf("theostones %+v", main.Gods)
	}
	if len(main.Rolled) != 1 || main.Rolled[0] != (catalogRolled{Name: "Combat Speed", Percent: true, Count: 2, Low: 11, Value: 13, High: 13}) {
		t.Fatalf("rolled %+v", main.Rolled)
	}
	if len(main.Boosts) != 1 || main.Boosts[0] != (catalogBoost{Name: "Bolt", Icon: "bolt.png", Count: 2, Level: 2, High: 2}) {
		t.Fatalf("boosts %+v", main.Boosts)
	}
	if ear := c.Slots[1].Items; len(ear) != 1 || ear[0].Count != 2 {
		t.Fatalf("earrings %+v", ear)
	}
	if pet := c.Slots[2].Items; len(pet) != 1 || pet[0].MaxLevel != 3 {
		t.Fatalf("pet %+v", pet)
	}

	// Kept a while for everyone: a new character joins once it is worked out again.
	classProfile(t, app, 6, "Chanter", at, armoryProfile{Gear: []armoryGear{{Slot: "Helmet", Name: "Hat", Grade: "Rare"}}}, false)
	if again := ask(t, app, http.MethodGet, "/api/odyle/armory/catalog/Chanter", nil, "", 200); again["characters"] != float64(3) {
		t.Fatalf("worked out again at once: %v", again["characters"])
	}
	cache := stateOf(app).catalogs
	cache.mu.Lock()
	cache.kept["Chanter"].at = time.Now().Add(-catalogKeep)
	cache.mu.Unlock()
	if again := ask(t, app, http.MethodGet, "/api/odyle/armory/catalog/Chanter", nil, "", 200); again["characters"] != float64(4) {
		t.Fatalf("not worked out again: %v", again["characters"])
	}
	// A class the armory knows nobody of has an empty catalog; an odd class is no page.
	if none := ask(t, app, http.MethodGet, "/api/odyle/armory/catalog/Templar", nil, "", 200); none["characters"] != float64(0) || len(none["slots"].([]any)) != 0 {
		t.Fatalf("nobody %v", none)
	}
	ask(t, app, http.MethodGet, "/api/odyle/armory/catalog/%3Cb%3E", nil, "", 404)
}

// A shared build's page is named after the build for link previews, and kept out of search
// engines like the account's own builds.
func TestBuildPagesAreNamed(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Lumina")
	saved(t, app, "builds", map[string]any{"user": user.Id, "name": "Boss build", "class": "Chanter", "plan": map[string]any{}, "share": "ABCDEFGHJKLMNPQR"})
	for route, title := range map[string]string{
		"/builds/shared/ABCDEFGHJKLMNPQR":        "Boss build · Chanter build · Odyle",
		"/builds/shared/ABCDEFGHJKLMNPQR/skills": "Boss build · Chanter build · Odyle",
		"/builds/shared/ZZZZZZZZZZZZZZZZ":        "A shared build · Odyle",
		"/builds":                                "Your builds · Odyle",
		"/builds/abc123def456ghi":                "A build · Odyle",
		"/builds/abc123def456ghi/daevanion":      "A build · Odyle",
	} {
		e, _ := pageEvent(app, route)
		if p := DescribePage(e, route, "https://odyle.example"); p.Title != title || !p.Private || p.Missing {
			t.Fatalf("%s: %+v", route, p)
		}
	}
	for _, route := range []string{"/builds/abc/nope", "/builds/shared/ABCDEFGHJKLMNPQR/nope", "/builds/a/b/c/d"} {
		e, _ := pageEvent(app, route)
		if p := DescribePage(e, route, ""); !p.Missing {
			t.Fatalf("%s: %+v", route, p)
		}
	}
}
