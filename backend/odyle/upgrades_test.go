package odyle

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
)

// gearOf is an equipped item with its details.
func gearOf(slot, name, grade string, enchant, itemLevel int64, detail func(*armoryItem)) armoryGear {
	d := &armoryItem{Category: "Mace", ItemLevel: itemLevel, Sources: []string{}, Stones: []armoryStone{}}
	if detail != nil {
		detail(d)
	}
	return armoryGear{Slot: slot, Name: name, Grade: grade, Enchant: enchant, Icon: name + ".png", Detail: d}
}

// The comparison counts each slot of the strongest characters (both earrings as one slot, the
// pet left out): who wears something there, its usual grade, the medians of its item level,
// enchantment and stones, the items worn most with where they come from, and the sets, boards
// and skills on the skill bar they share.
func TestUpgradesCompareTheStrongestOfAClass(t *testing.T) {
	vigor := func(d *armoryItem) { d.Set = &armorySet{Name: "Primal Vigor", Equipped: 2} }
	strongest := armoryProfile{Gear: []armoryGear{
		gearOf("MainHand", "Rod A", "Unique", 15, 102, func(d *armoryItem) {
			d.Sources, d.StoneSlots, d.Stones = []string{"Crafting"}, 2, []armoryStone{{Name: "Attack"}, {Name: "Attack"}}
		}),
		gearOf("Earring1", "Ear X", "Unique", 5, 54, nil), gearOf("Earring2", "Ear Y", "Legend", 3, 50, nil),
		gearOf("Arcana1", "Chalice of Vigor", "Unique", 0, 40, vigor), gearOf("Arcana2", "Bell of Vigor", "Unique", 0, 40, vigor),
		{Slot: "Pet", Name: "Pagati", Level: 3},
	}, Boards: []armoryBoard{{Name: "Nezekan", Open: 40, Total: 40}}, Skills: []armorySkill{{Name: "Bolt", Category: "Active", Level: 13, Equipped: true}, {Name: "Heal", Level: 9}}}
	second := armoryProfile{Gear: []armoryGear{
		gearOf("MainHand", "Rod A", "Unique", 13, 102, func(d *armoryItem) {
			d.Sources, d.StoneSlots, d.Stones = []string{"Crafting", "Abyss"}, 2, []armoryStone{{Name: "Critical Hit"}}
		}),
		gearOf("Earring1", "Ear X", "Unique", 7, 54, nil),
	}, Boards: []armoryBoard{{Name: "Nezekan", Open: 30, Total: 40}}, Skills: []armorySkill{{Name: "Bolt", Category: "Active", Level: 11, Equipped: true}}}
	third := armoryProfile{Gear: []armoryGear{{Slot: "MainHand", Name: "Rod B", Grade: "Legend", Enchant: 10}}}
	players := []upgradePlayer{{Name: "A", CombatPower: 300, ItemLevel: 1700}, {Name: "B", CombatPower: 200, ItemLevel: 1600}, {Name: "C", CombatPower: 100, ItemLevel: 1200}}
	at := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	ref := compareUpgrades("Chanter", players, []armoryProfile{strongest, second, third}, at)
	if ref.Class != "Chanter" || ref.CombatPower != (upgradeSpread{Median: 200, Low: 100, High: 300}) || ref.ItemLevel.Median != 1600 || ref.BuiltAt != "2026-11-20T10:00:00.000Z" {
		t.Fatalf("reference %+v", ref)
	}
	slots := []string{}
	for _, s := range ref.Slots {
		slots = append(slots, s.Slot)
	}
	if strings.Join(slots, ",") != "MainHand,Earring,Arcana1,Arcana2" {
		t.Fatalf("slots %v", slots)
	}
	main := ref.Slots[0]
	if main.Players != 3 || main.Items != 3 || main.Grade != "Unique" || main.Enchant != 13 || main.ItemLevel != 102 || main.Stones != 2 || main.StoneSlots != 2 {
		t.Fatalf("main hand %+v", main)
	}
	if len(main.Popular) != 2 || main.Popular[0].Name != "Rod A" || main.Popular[0].Count != 2 || main.Popular[0].Enchant != 15 || main.Popular[0].ItemLevel != 102 || main.Popular[0].Category != "Mace" ||
		strings.Join(main.Popular[0].Sources, ",") != "Crafting,Abyss" || main.Popular[0].Icon != "Rod A.png" || main.Popular[1].Name != "Rod B" || main.Popular[1].ItemLevel != 0 {
		t.Fatalf("main hand items %+v", main.Popular)
	}
	if len(main.StoneNames) != 2 || main.StoneNames[0] != (upgradeName{Name: "Attack", Count: 2}) || main.StoneNames[1].Name != "Critical Hit" {
		t.Fatalf("stones %+v", main.StoneNames)
	}
	if earring := ref.Slots[1]; earring.Players != 2 || earring.Items != 3 || earring.Popular[0].Name != "Ear X" || earring.Popular[0].Count != 2 || earring.Popular[0].Enchant != 7 || earring.Grade != "Unique" {
		t.Fatalf("earrings %+v", earring)
	}
	if len(ref.Sets) != 1 || ref.Sets[0] != (upgradeSet{Name: "Primal Vigor", Players: 1, Pieces: 2}) {
		t.Fatalf("sets %+v", ref.Sets)
	}
	if len(ref.Boards) != 1 || ref.Boards[0] != (upgradeBoard{Name: "Nezekan", Players: 2, Open: 40, Total: 40}) {
		t.Fatalf("boards %+v", ref.Boards)
	}
	if len(ref.Skills) != 1 || ref.Skills[0] != (upgradeSkill{Name: "Bolt", Category: "Active", Players: 2, Level: 13}) {
		t.Fatalf("skills %+v", ref.Skills)
	}
	if empty := compareUpgrades("Chanter", []upgradePlayer{}, nil, at); len(empty.Slots) != 0 || empty.CombatPower != (upgradeSpread{}) {
		t.Fatalf("nobody to compare with %+v", empty)
	}
}

// The route compares the strongest kept profiles of the class, hidden ones, those of an older
// shape and the profile it is for left out; every saved profile names its class and combat power
// for it.
func TestUpgradesRouteListsTheStrongestKeptOfAClass(t *testing.T) {
	app := newTestApp(t)
	keep := func(n int, class string, power int64, values map[string]any) {
		t.Helper()
		profile := map[string]any{"v": armoryVersion, "name": fmt.Sprintf("Hero%d", n), "level": 45, "class": class, "server": "Lumiel", "combatPower": power, "itemLevel": power / 100, "portrait": "",
			"stats": []any{}, "gear": []any{map[string]any{"slot": "MainHand", "name": "Rod", "grade": "Unique", "enchant": 10, "exceed": 0}}, "skins": []any{}, "skills": []any{}, "boards": []any{}}
		record := map[string]any{"region": "eu", "serverId": 2304, "characterId": fmt.Sprintf("AAAAAAAAAAAAAAAAAAAAAAA%d", n), "viewedAt": ago(time.Hour), "profile": profile}
		for k, v := range values {
			if k == "v" {
				profile["v"] = v
			} else {
				record[k] = v
			}
		}
		saved(t, app, "armory_profiles", record)
	}
	keep(1, "Chanter", 100000, nil)
	keep(2, "Chanter", 300000, nil)
	keep(3, "Chanter", 200000, nil)
	keep(4, "Chanter", 400000, map[string]any{"hidden": true})
	keep(5, "Chanter", 500000, map[string]any{"v": 1})
	keep(6, "Cleric", 900000, nil)
	var class string
	var power int64
	if err := app.DB().NewQuery("SELECT class, combatPower FROM armory_profiles WHERE characterId = 'AAAAAAAAAAAAAAAAAAAAAAA2'").Row(&class, &power); err != nil || class != "Chanter" || power != 300000 {
		t.Fatalf("a saved profile names %q %d (%v)", class, power, err)
	}
	body, headers := fetch(t, app, "/api/odyle/armory/upgrades/Chanter", 200)
	var ref upgradeReference
	if err := json.Unmarshal(body, &ref); err != nil {
		t.Fatal(err)
	}
	order := []string{}
	for _, p := range ref.Players {
		order = append(order, fmt.Sprintf("%s %d", p.Name, p.CombatPower))
	}
	if strings.Join(order, ",") != "Hero2 300000,Hero3 200000,Hero1 100000" || ref.Players[0].Region != "eu" || ref.Players[0].ServerId != 2304 || ref.Players[0].CharacterId != "AAAAAAAAAAAAAAAAAAAAAAA2" || ref.Players[0].Server != "Lumiel" {
		t.Fatalf("players %+v", ref.Players)
	}
	if len(ref.Slots) != 1 || ref.Slots[0].Players != 3 || ref.Slots[0].Popular[0].Name != "Rod" || headers.Get("Cache-Control") != "public, max-age=300" {
		t.Fatalf("reference %+v, %v", ref, headers)
	}
	// The profile the comparison is for is not one of the strongest it is compared with.
	without := ask(t, app, "GET", "/api/odyle/armory/upgrades/Chanter?serverId=2304&characterId=AAAAAAAAAAAAAAAAAAAAAAA2", nil, "", 200)
	if others := without["players"].([]any); len(others) != 2 || others[0].(map[string]any)["name"] != "Hero3" {
		t.Fatalf("without itself: %v", others)
	}
	// What the comparison does not read is not kept.
	if kept := stateOf(app).upgrades.kept["Chanter"]; len(kept.profiles) != 3 || kept.profiles[0].Stats != nil {
		t.Fatalf("kept %+v", kept.profiles)
	}
	// Kept for everyone a while: a stronger character joins once it is worked out again.
	keep(7, "Chanter", 600000, nil)
	if again := ask(t, app, "GET", "/api/odyle/armory/upgrades/Chanter", nil, "", 200); len(again["players"].([]any)) != 3 {
		t.Fatalf("worked out again at once: %v", again["players"])
	}
	kept := stateOf(app).upgrades.kept["Chanter"]
	kept.at = time.Now().Add(-upgradeKeep)
	stateOf(app).upgrades.kept["Chanter"] = kept
	if again := ask(t, app, "GET", "/api/odyle/armory/upgrades/Chanter", nil, "", 200); len(again["players"].([]any)) != 4 || again["players"].([]any)[0].(map[string]any)["name"] != "Hero7" {
		t.Fatalf("not worked out again: %v", again["players"])
	}
	// A class the armory keeps no character of compares with nobody, and is not kept.
	if none := ask(t, app, "GET", "/api/odyle/armory/upgrades/Templar", nil, "", 200); len(none["players"].([]any)) != 0 || len(none["slots"].([]any)) != 0 {
		t.Fatalf("nobody: %v", none)
	}
	if _, kept := stateOf(app).upgrades.kept["Templar"]; kept {
		t.Fatal("an empty comparison is kept")
	}
	ask(t, app, "GET", "/api/odyle/armory/upgrades/%3Cb%3E", nil, "", 404)
	// A profile that loses its class with a lookup's error stays found by what it holds.
	if _, err := app.DB().NewQuery("UPDATE armory_profiles SET class = '' WHERE characterId = 'AAAAAAAAAAAAAAAAAAAAAAA1'").Execute(); err != nil {
		t.Fatal(err)
	}
	record, err := keptProfile(app, 2304, "AAAAAAAAAAAAAAAAAAAAAAA1")
	if err != nil {
		t.Fatal(err)
	}
	record.Set("error", "PLAYNC answered 500.")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if err := app.DB().Select("class").From("armory_profiles").Where(dbx.HashExp{"id": record.Id}).Row(&class); err != nil || class != "Chanter" {
		t.Fatalf("class %q (%v)", class, err)
	}
}
