package odyle

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// icon is how PLAYNC links a game icon.
func icon(name string) string { return armoryIconBase + name }

// officialInfo, officialEquipment, officialItem and officialBoard are shaped like PLAYNC's
// answers (docs/armory.md).
func officialInfo(name string) map[string]any {
	return map[string]any{
		"profile": map[string]any{"characterName": name, "characterLevel": 45, "className": "Chanter", "pcId": 36, "combatPower": 107458, "raceName": "Asmodians", "genderName": "Female", "serverName": "Lumiel", "titleName": "Golden Glow", "titleGrade": "Unique", "regionName": "Golden Order",
			"profileImage": "https://profileimg.plaync.com/game_profile_images/aion2global/images?gameServerKey=2304&charKey=1"},
		"stat": map[string]any{"statList": []any{
			map[string]any{"type": "STR", "name": "Might", "value": 45, "statSecondList": []any{"Attack increase +4.5%"}}, map[string]any{"type": "WIS", "name": "Willpower", "value": 8, "statSecondList": nil},
			map[string]any{"type": "Justice", "name": "Justice [Nezekan]", "value": 41, "statSecondList": []any{"Defense increase +4.1%", "Perfect Chance +4.1%"}}, map[string]any{"type": "ItemLevel", "name": "아이템레벨", "value": 1671},
		}},
		"title": map[string]any{"ownedCount": 94, "totalCount": 304, "titleList": []any{
			map[string]any{"equipCategory": "Attack", "name": "Guardian of Altgard", "grade": "Legend", "ownedCount": 36, "totalCount": 105, "equipStatList": []any{map[string]any{"desc": "PvE Damage Boost +3%"}}, "statList": []any{map[string]any{"desc": "PvE Attack +4"}}},
			map[string]any{"equipCategory": "Etc", "name": nil, "grade": nil, "ownedCount": 27, "totalCount": 101, "equipStatList": nil, "statList": nil},
		}},
		"ranking": map[string]any{"rankingList": []any{map[string]any{"rankingContentsName": "Left out"}}},
		"daevanion": map[string]any{"boardList": []any{
			map[string]any{"id": 71, "name": "Nezekan", "openNodeCount": 12, "totalNodeCount": 40, "open": 1, "icon": icon("UT_Weapon_Mace.png")},
			map[string]any{"id": 74, "name": "Triniel", "openNodeCount": 0, "totalNodeCount": 116, "open": 1},
		}},
	}
}

func officialEquipment() map[string]any {
	return map[string]any{
		"equipment": map[string]any{"equipmentList": []any{
			map[string]any{"id": 210130053, "slotPos": 5, "slotPosName": "Torso", "name": "Vakron Breastplate", "grade": "Unique", "enchantLevel": 10, "exceedLevel": 0, "icon": icon("Missing_Torso.png")},
			map[string]any{"id": 110830051, "slotPos": 1, "slotPosName": "MainHand", "name": "Enraged Kromede Rod", "grade": "Unique", "enchantLevel": 15, "exceedLevel": 3, "icon": icon("Icon_WP_MA_0078_T05.png")},
		}, "skinList": []any{
			map[string]any{"id": 30046101, "slotPos": 3, "slotPosName": "Torso", "name": "Howling Dragon (Breastplate)", "grade": "Unique", "icon": "https://example.com/elsewhere.png"},
			map[string]any{"id": 20005107, "slotPos": 15, "slotPosName": "MaceMain", "name": "Eternal Sun (Mace)", "grade": "Special"},
		}},
		"petwing": map[string]any{"pet": map[string]any{"id": 1001, "name": "Pagati", "level": 3}, "wing": map[string]any{"id": 40200700, "name": "Forest Spirit Wings", "grade": "Unique", "enchantLevel": 0},
			"wingSkin": map[string]any{"id": 40200700, "name": "Forest Spirit Wings", "grade": "Unique"}},
		"skill": map[string]any{"skillList": []any{
			map[string]any{"name": "Earth's Retribution", "category": "Active", "skillLevel": 13, "needLevel": 1, "acquired": 1, "equip": 1, "icon": icon("ICON_CL_SKILL_001.png")},
			map[string]any{"name": "Absolution", "category": "Dp", "skillLevel": 0, "needLevel": 22, "acquired": 0, "equip": 0},
		}},
	}
}

// officialItem is the item page of the main hand (its details for this character).
func officialItem() map[string]any {
	return map[string]any{"id": 110830051, "name": "Enraged Kromede Rod", "grade": "Unique", "level": 102, "enchantLevel": 15, "maxEnchantLevel": 15, "maxExceedEnchantLevel": 5, "raceName": "All", "classNames": []any{"Chanter"},
		"categoryName": "Mace", "type": "Equip", "equipLevel": 45, "tradable": false, "storable": true, "magicStoneSlotCount": 2, "godStoneSlotCount": 1, "subStatCount": 2, "soulBindRate": "63.8",
		"mainStats": []any{map[string]any{"name": "Attack", "minValue": "315", "value": "630", "extra": "174", "exceed": false}, map[string]any{"name": "Accuracy", "value": "50", "extra": "0", "exceed": false},
			map[string]any{"name": "Attack", "value": "0", "extra": "40", "exceed": true}},
		"subStats":       []any{map[string]any{"name": "Combat Speed", "value": "13%"}, map[string]any{"name": "Might", "minValue": "32", "value": "32"}},
		"subSkills":      []any{map[string]any{"name": "Combustion", "level": 2, "icon": icon("ICON_EL_SKILL_004.png")}},
		"magicStoneStat": []any{map[string]any{"name": "Attack", "value": "+10", "grade": "Unique", "icon": icon("Icon_Item_Usable_Enchant_MagicStone_A_c_003.png")}},
		"godStoneStat":   []any{map[string]any{"name": "Freezing Godstone", "grade": "Legend", "desc": "<desc_point>Freezes</desc_point> the target\nfor 2 s."}},
		"set": map[string]any{"name": "Primal Vigor", "equippedCount": 2, "items": []any{map[string]any{"name": "Chalice of Vigor", "grade": "Unique", "equipped": true}, map[string]any{"name": "Bell of Vigor", "grade": "Unique"}},
			"bonuses": []any{map[string]any{"degree": 2, "descriptions": []any{"+60 PvE Attack"}}}},
		"sources": []any{"Crafting"}, "costumes": []any{"Golden Vow (Mace)"}}
}

// officialBoard is a board's page: its nodes (empty cells too) and its open effects.
func officialBoard() map[string]any {
	return map[string]any{"nodeList": []any{
		map[string]any{"row": 3, "col": 3, "grade": "Unique", "type": "Stat", "open": 1, "name": "Combat Speed", "effectList": []any{map[string]any{"desc": "Combat Speed +1.5%"}}},
		map[string]any{"row": 3, "col": 4, "grade": "None", "type": "None", "open": 0, "name": "", "effectList": []any{}},
		map[string]any{"row": 8, "col": 8, "grade": "None", "type": "Start", "open": 0, "name": "Nezekan - Start", "effectList": []any{map[string]any{"desc": ""}}},
		map[string]any{"row": 3, "col": 7, "grade": "Rare", "type": "SkillLevel", "open": 0, "name": "Skill Level Up - Bolt", "effectList": []any{map[string]any{"desc": "Bolt +1"}}},
	}, "openStatEffectList": []any{map[string]any{"desc": "Combat Speed +1.5%"}}, "openSkillEffectList": []any{map[string]any{"desc": "Bolt +1"}}}
}

// pngOf is a square PNG of the given size.
func pngOf(t testing.TB, size int) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := png.Encode(&out, image.NewNRGBA(image.Rect(0, 0, size, size))); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
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
	if p.Version != armoryVersion || p.Name != "Ka" || p.Legion != "Golden Order" || p.Level != 45 || p.Class != "Chanter" || p.Gender != "Female" || p.CombatPower != 107458 || p.ItemLevel != 1671 || p.Server != "Lumiel" || p.Title != "Golden Glow" {
		t.Fatalf("profile %+v", p)
	}
	if len(p.Stats) != 3 || !p.Stats[0].Primary || p.Stats[2].Primary || p.Stats[2].Name != "Justice" || p.Stats[2].Deity != "Nezekan" ||
		strings.Join(p.Stats[2].Effects, ",") != "Defense increase +4.1%,Perfect Chance +4.1%" || len(p.Stats[1].Effects) != 0 {
		t.Fatalf("stats %+v", p.Stats)
	}
	slots := []string{}
	for _, g := range p.Gear {
		slots = append(slots, g.Slot)
	}
	if strings.Join(slots, ",") != "MainHand,Torso,Wings,Pet" || p.Gear[0].Enchant != 15 || p.Gear[0].Exceed != 3 || p.Gear[3].Level != 3 || p.Gear[0].Icon != "Icon_WP_MA_0078_T05.png" || p.Gear[0].id != 110830051 || p.Gear[0].order != 1 {
		t.Fatalf("gear %+v", p.Gear)
	}
	// Skins in their slots' order, the wings' only when it differs from the wings.
	if len(p.Skins) != 2 || p.Skins[0].Slot != "Torso" || p.Skins[0].Icon != "" || p.Skins[1].Name != "Eternal Sun (Mace)" {
		t.Fatalf("skins %+v", p.Skins)
	}
	if len(p.Skills) != 2 || !p.Skills[0].Equipped || !p.Skills[0].Acquired || p.Skills[0].Level != 13 || p.Skills[0].Icon != "ICON_CL_SKILL_001.png" || p.Skills[1].Acquired || p.Skills[1].Category != "Dp" {
		t.Fatalf("skills %+v", p.Skills)
	}
	if p.Titles.Owned != 94 || p.Titles.Total != 304 || len(p.Titles.Equipped) != 2 || p.Titles.Equipped[0].Effects[0] != "PvE Damage Boost +3%" || p.Titles.Equipped[0].Stats[0] != "PvE Attack +4" || p.Titles.Equipped[1].Name != "" {
		t.Fatalf("titles %+v", p.Titles)
	}
	if len(p.Boards) != 2 || p.Boards[0].Id != 71 || p.Boards[0].Open != 12 || p.Boards[0].Total != 40 || p.Boards[0].Icon != "UT_Weapon_Mace.png" {
		t.Fatalf("boards %+v", p.Boards)
	}
	// Rankings and links to PLAYNC are not kept: images only by the name the Odyle server keeps them under.
	raw, _ := json.Marshal(p)
	for _, left := range []string{"Left out", "https://", "playnccdn"} {
		if strings.Contains(string(raw), left) {
			t.Fatalf("kept %q: %s", left, raw)
		}
	}
	if _, err := readArmory(map[string]any{"detail": "Resource not found"}, decoded(t, officialEquipment())); err == nil {
		t.Fatal("an answer without a character was read")
	}
}

func TestArmoryReadsItemsAndBoards(t *testing.T) {
	d := readItem(decoded(t, officialItem()))
	if d == nil || d.Category != "Mace" || d.ItemLevel != 102 || d.MaxEnchant != 15 || d.MaxExceed != 5 || d.EquipLevel != 45 || d.SoulBind != "63.8" || !d.Storable || d.Tradable {
		t.Fatalf("item %+v", d)
	}
	if len(d.Main) != 3 || d.Main[0] != (armoryLine{Name: "Attack", Min: "315", Value: "630", Extra: "174"}) || d.Main[1].Extra != "" || !d.Main[2].Exceed {
		t.Fatalf("main %+v", d.Main)
	}
	if len(d.Sub) != 2 || d.Sub[1].Min != "" || d.SubSkills[0] != (armorySubSkill{Name: "Combustion", Level: 2, Icon: "ICON_EL_SKILL_004.png"}) {
		t.Fatalf("soul binding %+v %+v", d.Sub, d.SubSkills)
	}
	if d.StoneSlots != 2 || len(d.Stones) != 1 || d.Stones[0].Value != "+10" || d.GodSlots != 1 || d.GodStones[0].Desc != "Freezes the target for 2 s." {
		t.Fatalf("stones %+v %+v", d.Stones, d.GodStones)
	}
	if d.Set == nil || d.Set.Name != "Primal Vigor" || d.Set.Equipped != 2 || !d.Set.Items[0].Equipped || d.Set.Items[1].Equipped || d.Set.Bonuses[0].Count != 2 || d.Set.Bonuses[0].Effects[0] != "+60 PvE Attack" {
		t.Fatalf("set %+v", d.Set)
	}
	if d.Sources[0] != "Crafting" || d.Skins[0] != "Golden Vow (Mace)" || readItem(map[string]any{}) != nil {
		t.Fatalf("item %+v", d)
	}
	b := armoryBoard{Nodes: []armoryNode{}}
	readBoard(&b, decoded(t, officialBoard()))
	// Empty cells are left out, nodes go by row and column, and a node's effect stands for its name.
	if len(b.Nodes) != 3 || b.Nodes[0] != (armoryNode{Row: 3, Col: 3, Grade: "Unique", Type: "Stat", Open: true, Effect: "Combat Speed +1.5%"}) || b.Nodes[1].Effect != "Bolt +1" || b.Nodes[1].Open || b.Nodes[2].Name != "Nezekan - Start" {
		t.Fatalf("nodes %+v", b.Nodes)
	}
	if strings.Join(b.StatEffects, ",") != "Combat Speed +1.5%" || strings.Join(b.SkillEffects, ",") != "Bolt +1" {
		t.Fatalf("effects %+v %+v", b.StatEffects, b.SkillEffects)
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

// armoryStand stands in for PLAYNC's character pages, search, icons and portraits: characters
// whose id starts with "missing" are not listed, "refused" ones get 429; gate, when set, holds
// each answer, and held the item and board pages'. lookups counts the info pages asked for
// (one a lookup), details the item and board pages, images the icons and portraits, and
// together the most images downloaded at once; classLists the class lists and classIcons the
// class emblems (the Ranger's is missing).
type armoryStand struct {
	lookups, details, images, searches atomic.Int32
	downloading, together              atomic.Int32
	classLists, classIcons             atomic.Int32
	gate, held                         chan struct{}
	url                                string
}

// download counts an image being downloaded, for a moment, alongside the others.
func (s *armoryStand) download() {
	s.images.Add(1)
	now := s.downloading.Add(1)
	for most := s.together.Load(); now > most && !s.together.CompareAndSwap(most, now); most = s.together.Load() {
	}
	time.Sleep(10 * time.Millisecond)
	s.downloading.Add(-1)
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
				map[string]any{"characterId": id, "name": "<strong>" + q.Get("keyword") + "</strong>", "level": 45, "race": 2, "pcId": 36, "serverId": json.RawMessage(serverId)},
				map[string]any{"characterId": "bad id", "name": q.Get("keyword"), "serverId": 2304},
			}})
			return
		}
		if name, ok := strings.CutPrefix(r.URL.Path, "/assets/"); ok {
			s.download()
			// One icon is missing, as a few are on PLAYNC's CDN; skills come at full size.
			if strings.HasPrefix(name, "Missing") {
				w.WriteHeader(404)
				return
			}
			w.Write(pngOf(t, map[bool]int{true: 256, false: 64}[strings.HasPrefix(name, "ICON")]))
			return
		}
		if r.URL.Path == "/game_profile_images/aion2global/images" {
			s.download()
			w.Header().Set("Content-Type", "image/png")
			w.Write(pngOf(t, 80))
			return
		}
		if r.URL.Path == "/en-us/api/gameinfo/pcdata" {
			s.classLists.Add(1)
			json.NewEncoder(w).Encode(map[string]any{"pcDataList": []any{
				map[string]any{"id": 33, "className": "CHANTER", "classText": "Chanter"},
				map[string]any{"id": 36, "className": "CHANTER", "classText": "Chanter"},
				map[string]any{"id": 15, "className": "RANGER", "classText": "Ranger"},
				map[string]any{"id": 21, "className": "ELEMENTALIST", "classText": "Spiritmaster"},
				map[string]any{"id": 99, "className": "../x", "classText": "Bad"},
			}})
			return
		}
		if name, ok := strings.CutPrefix(r.URL.Path, "/class/"); ok {
			s.classIcons.Add(1)
			if name == "class_icon_ranger.png" {
				w.WriteHeader(404)
				return
			}
			w.Write(pngOf(t, 256))
			return
		}
		if r.URL.Path == "/api/character/info" {
			s.lookups.Add(1)
		} else {
			s.details.Add(1)
		}
		if s.held != nil && (r.URL.Path == "/api/character/equipment/item" || r.URL.Path == "/api/character/daevanion/detail") {
			<-s.held
		}
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
		case r.URL.Path == "/api/character/equipment/item" && q.Get("id") == "110830051" && q.Get("slotPos") == "1" && q.Get("enchantLevel") == "15":
			json.NewEncoder(w).Encode(officialItem())
		case r.URL.Path == "/api/character/daevanion/detail" && q.Get("boardId") == "71":
			json.NewEncoder(w).Encode(officialBoard())
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(server.Close)
	s.url = server.URL
	t.Setenv("PLAYNC_ARMORY_URL", server.URL)
	t.Setenv("PLAYNC_SEARCH_URL", server.URL+"/search")
	t.Setenv("PLAYNC_ASSETS_URL", server.URL+"/assets/")
	t.Setenv("PLAYNC_IMAGE_URL", server.URL)
	t.Setenv("PLAYNC_CLASS_ICONS_URL", server.URL+"/class/")
}

func fastArmory(t *testing.T) {
	pace, step, gap := armoryPace, armoryStep, armorySearchGap
	armoryPace, armoryStep, armorySearchGap = 20*time.Millisecond, time.Millisecond, 10*time.Millisecond
	t.Cleanup(func() { armoryPace, armoryStep, armorySearchGap = pace, step, gap })
}

func armoryPath(id string) string { return "/api/odyle/armory/eu/2304/" + id }

func TestArmoryFetchesProfilesThroughTheQueueAndKeepsThem(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	first := ask(t, app, "GET", armoryPath(id), nil, "", 200)
	// Next in line: the page asks again in two seconds, to follow the lookup as it starts.
	if first["state"] != "queued" || first["profile"] != nil || first["server"] != "Lumiel" || first["retryAfter"].(float64) != 2 {
		t.Fatalf("first look: %v", first)
	}
	stateOf(app).armory.wait()
	kept := ask(t, app, "GET", armoryPath(id), nil, "", 200)
	profile, _ := kept["profile"].(map[string]any)
	if kept["state"] != "fresh" || profile["name"] != "Hero" || profile["combatPower"].(float64) != 107458 || kept["fetchedAt"] == "" || stand.lookups.Load() != 1 {
		t.Fatalf("kept: %v after %d lookups", kept, stand.lookups.Load())
	}
	// A fresh profile is read from the database, a Refresh only counts after 15 minutes.
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	if again := ask(t, app, "GET", armoryPath(id)+"?refresh=1", nil, "", 200); again["state"] != "fresh" || stand.lookups.Load() != 1 {
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
	if n := countOf(t, app, "armory_profiles"); n != 1 || stand.lookups.Load() != 3 {
		t.Fatalf("%d profiles after %d lookups", n, stand.lookups.Load())
	}
	// A hidden profile is gone from the armory and never fetched again.
	if _, err := app.DB().NewQuery("UPDATE armory_profiles SET hidden = TRUE, fetchedAt = ''").Execute(); err != nil {
		t.Fatal(err)
	}
	ask(t, app, "GET", armoryPath(id), nil, "", 404)
	// Ids that cannot be PLAYNC's, and servers outside the region, are not asked for.
	ask(t, app, "GET", "/api/odyle/armory/nae/2304/"+id, nil, "", 404)
	ask(t, app, "GET", armoryPath("short"), nil, "", 404)
	if stand.lookups.Load() != 3 {
		t.Fatalf("%d lookups", stand.lookups.Load())
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
	if stand.lookups.Load() != 1 || stand.details.Load() != 0 || countOf(t, app, "armory_profiles") != 0 {
		t.Fatalf("%d lookups, %d details", stand.lookups.Load(), stand.details.Load())
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
	// Further back, it asks again about when its lookup is due to start, at most 15 seconds on.
	if third := ask(t, app, "GET", armoryPath("AAAAAAAAAAAAAAAAAAAAAAA3"), nil, "", 200); third["position"].(float64) != 2 || third["retryAfter"].(float64) != 15 {
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
	if n := stand.lookups.Load(); n != 1 {
		t.Fatalf("%d lookups while paused", n)
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

// fetch asks a route for raw bytes, with its headers.
func fetch(t *testing.T, app *tests.TestApp, url string, status int) (body []byte, headers http.Header) {
	t.Helper()
	(&tests.ApiScenario{Name: "GET " + url, Method: "GET", URL: url, ExpectedStatus: status, ExpectedContent: []string{""},
		TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, _ = io.ReadAll(res.Body)
			headers = res.Header
		}}).Test(t)
	return body, headers
}

// A lookup also reads each equipped item's and each open board's page, keeps the icons and
// the portrait they name on the server, and the page loads them from there.
func TestArmoryKeepsItemsBoardsAndImages(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	stateOf(app).armory.wait()
	// Two items (the wings and the pet have no item page) and the one board with open nodes.
	if stand.lookups.Load() != 1 || stand.details.Load() != 4 {
		t.Fatalf("%d lookups, %d details", stand.lookups.Load(), stand.details.Load())
	}
	kept := ask(t, app, "GET", armoryPath(id), nil, "", 200)
	var p armoryProfile
	raw, _ := json.Marshal(kept["profile"])
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	main, torso := p.Gear[0], p.Gear[1]
	if main.Detail == nil || main.Detail.Category != "Mace" || main.Detail.Set == nil || torso.Detail != nil || p.Boards[0].Nodes[0].Effect != "Combat Speed +1.5%" || len(p.Boards[1].Nodes) != 0 {
		t.Fatalf("details: %s", raw)
	}
	// The icon PLAYNC lacks is left out; the others and the portrait are kept, skills' shrunk.
	if torso.Icon != "" || main.Icon != "Icon_WP_MA_0078_T05.png" || !strings.HasPrefix(p.Portrait, "portrait-") || !strings.HasSuffix(p.Portrait, ".png") || p.Skills[0].Icon != "ICON_CL_SKILL_001.png" {
		t.Fatalf("images: %s", raw)
	}
	body, headers := fetch(t, app, "/api/odyle/armory-images/"+p.Skills[0].Icon, 200)
	config, err := png.DecodeConfig(bytes.NewReader(body))
	if err != nil || config.Width != iconSize || headers.Get("Content-Type") != "image/png" || !strings.Contains(headers.Get("Cache-Control"), "immutable") {
		t.Fatalf("icon %v %v %v", config, err, headers)
	}
	if body, _ := fetch(t, app, "/api/odyle/armory-images/"+main.Icon, 200); len(body) == 0 {
		t.Fatal("no main hand icon")
	}
	fetch(t, app, "/api/odyle/armory-images/"+p.Portrait, 200)
	for _, name := range []string{"Missing_Torso.png", "..%2Fdata.db", "x.gif", "portrait-1.png"} {
		fetch(t, app, "/api/odyle/armory-images/"+name, 404)
	}
	// The next lookup downloads only what the server does not keep yet (the missing icon) and
	// the portrait, which may have changed.
	images := stand.images.Load()
	if _, err := app.DB().NewQuery("UPDATE armory_profiles SET fetchedAt = {:at}").Bind(dbx.Params{"at": ago(7 * time.Hour)}).Execute(); err != nil {
		t.Fatal(err)
	}
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	stateOf(app).armory.wait()
	if got := stand.images.Load() - images; got != 2 {
		t.Fatalf("%d images downloaded again", got)
	}
	// Six images of the profile and the emblems of the Chanter and the Spiritmaster.
	if status := armoryStatus(app); status["images"].(int) != 8 || status["imageBytes"].(int64) == 0 {
		t.Fatalf("status %v", status)
	}
}

// While a lookup reads the items' and boards' pages, a reader with no kept profile sees what
// PLAYNC's character pages gave, with its icons, and how far the lookup got. Images come
// side by side.
func TestArmoryShowsTheProfileWhileItsDetailsLoad(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{held: make(chan struct{})}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	if first := ask(t, app, "GET", armoryPath(id), nil, "", 200); first["partial"] != false || first["progress"] != nil {
		t.Fatalf("queued: %v", first)
	}
	var shown map[string]any
	for i := 0; i < 400; i++ {
		shown = ask(t, app, "GET", armoryPath(id), nil, "", 200)
		if progress, _ := shown["progress"].(map[string]any); shown["partial"] == true && progress["step"] == "items" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	progress, _ := shown["progress"].(map[string]any)
	profile, _ := shown["profile"].(map[string]any)
	if shown["state"] != "fetching" || shown["partial"] != true || progress["step"] != "items" || progress["done"].(float64) != 0 || progress["total"].(float64) != 2 || progress["percent"].(float64) < 10 || progress["percent"].(float64) > 50 {
		t.Fatalf("while the details load: %v", shown)
	}
	main, _ := profile["gear"].([]any)[0].(map[string]any)
	if profile["name"] != "Hero" || main["icon"] != "Icon_WP_MA_0078_T05.png" || main["detail"] != nil || !strings.HasPrefix(profile["portrait"].(string), "portrait-") {
		t.Fatalf("partial profile: %v", profile)
	}
	if stand.together.Load() < 2 {
		t.Fatalf("images one at a time: %d", stand.together.Load())
	}
	close(stand.held)
	stateOf(app).armory.wait()
	kept := ask(t, app, "GET", armoryPath(id), nil, "", 200)
	main, _ = kept["profile"].(map[string]any)["gear"].([]any)[0].(map[string]any)
	if kept["state"] != "fresh" || kept["partial"] != false || kept["progress"] != nil || main["detail"] == nil {
		t.Fatalf("kept: %v", kept)
	}
}

// The progress counts PLAYNC's pages as one and images as a tenth, never goes back and
// reaches 100 only once the lookup ends.
func TestArmoryTrackCountsTheLookup(t *testing.T) {
	track := newArmoryTrack()
	percent := func() int { p, _ := track.read(); return p.Percent }
	seen := []int{}
	track.begin("profile", 2, 1)
	track.tick()
	seen = append(seen, percent())
	track.tick()
	track.plan(4, 1)
	seen = append(seen, percent())
	track.begin("images", 10, imageWorth)
	for range 10 {
		track.tick()
	}
	seen = append(seen, percent())
	track.begin("items", 4, 1)
	for range 4 {
		track.tick()
	}
	seen = append(seen, percent())
	track.begin("boards", 1, 1)
	track.tick()
	track.begin("images", 0, imageWorth)
	seen = append(seen, percent())
	if fmt.Sprint(seen) != "[3 26 35 82 99]" {
		t.Fatalf("percent %v", seen)
	}
	var none *armoryTrack
	none.begin("profile", 2, 1)
	none.tick()
	if progress, partial := none.read(); progress != nil || partial != "" {
		t.Fatal("a nil track")
	}
}

// A profile kept before the armory kept everything is fetched again when opened.
func TestArmoryFetchesProfilesOfAnOlderShapeAgain(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": id, "name": "Hero", "fetchedAt": ago(time.Hour), "viewedAt": ago(time.Hour),
		"profile": map[string]any{"name": "Hero", "level": 45, "stats": []any{}, "gear": []any{}, "boards": []any{}}})
	old := ask(t, app, "GET", armoryPath(id), nil, "", 200)
	if old["state"] != "queued" || old["profile"] == nil {
		t.Fatalf("an old profile shows while it is fetched again: %v", old)
	}
	stateOf(app).armory.wait()
	if again := ask(t, app, "GET", armoryPath(id), nil, "", 200); again["state"] != "fresh" || again["profile"].(map[string]any)["v"].(float64) != armoryVersion {
		t.Fatalf("fetched again: %v", again)
	}
}

// The clean-up deletes the images no kept profile names, once they are an hour old.
func TestArmoryForgetsImagesNoProfileNames(t *testing.T) {
	app := newTestApp(t)
	dir := imageDir(app)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Named.png", "portrait-named.jpg", "Old.png", "New.png"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if name != "New.png" {
			past := time.Now().Add(-2 * time.Hour)
			os.Chtimes(filepath.Join(dir, name), past, past)
		}
	}
	saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": "AAAAAAAAAAAAAAAAAAAAAAA1", "viewedAt": ago(time.Hour),
		"profile": map[string]any{"portrait": "portrait-named.jpg", "gear": []any{map[string]any{"slot": "MainHand", "icon": "Named.png"}}}})
	saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": "AAAAAAAAAAAAAAAAAAAAAAA2", "viewedAt": ago(time.Hour)})
	if _, err := cleanArmory(app); err != nil {
		t.Fatal(err)
	}
	left, _ := os.ReadDir(dir)
	names := []string{}
	for _, entry := range left {
		names = append(names, entry.Name())
	}
	if strings.Join(names, ",") != "Named.png,New.png,portrait-named.jpg" {
		t.Fatalf("left %v", names)
	}
}

func TestArmoryShrinksIcons(t *testing.T) {
	small := pngOf(t, 64)
	if out, err := shrinkIcon(small); err != nil || !bytes.Equal(out, small) {
		t.Fatalf("a small icon changed: %v", err)
	}
	var wide bytes.Buffer
	png.Encode(&wide, image.NewNRGBA(image.Rect(0, 0, 512, 256)))
	out, err := shrinkIcon(wide.Bytes())
	config, _ := png.DecodeConfig(bytes.NewReader(out))
	if err != nil || config.Width != iconSize || config.Height != iconSize/2 {
		t.Fatalf("%v %v", config, err)
	}
	if _, err := shrinkIcon(pngOf(t, 3000)); err == nil {
		t.Fatal("a huge icon was decoded")
	}
}
