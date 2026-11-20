package odyle

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
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
	// Rolled stats: the first two rods roll Combat Speed (one twice, summed) and the first Critical
	// Hit too; the third rod's are unknown (a build kept before 0.64.0).
	strongest.Gear[0].Detail.Sub = []armoryLine{{Name: "Combat Speed", Value: "13%"}, {Name: "Critical Hit", Value: "1,200"}, {Name: "Odd", Value: "?"}}
	second.Gear[0].Detail.Sub = []armoryLine{{Name: "Combat Speed", Value: "4%"}, {Name: "Combat Speed", Value: "5.5%"}, {Name: "Critical Hit", Value: "+12%"}}
	players := []upgradePlayer{{Name: "A", CombatPower: 300, ItemLevel: 1700}, {Name: "B", CombatPower: 200, ItemLevel: 1600}, {Name: "C", CombatPower: 100, ItemLevel: 1200}}
	at := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	ref := compareUpgrades("Chanter", players, []armoryProfile{strongest, second, third}, at)
	if ref.Sample != 3 || len(ref.CombatPowers) != 3 || ref.CombatPowers[0] != 300 || ref.Class != "Chanter" || ref.CombatPower != (upgradeSpread{Median: 200, Low: 100, High: 300}) || ref.ItemLevel.Median != 1600 || ref.BuiltAt != "2026-11-20T10:00:00.000Z" {
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
	// A share and a number of one name are two stats; the median of two is the upper one.
	if main.RolledItems != 2 || len(main.Rolled) != 3 || main.Rolled[0] != (upgradeRolled{Name: "Combat Speed", Percent: true, Count: 2, Value: 13}) ||
		main.Rolled[1] != (upgradeRolled{Name: "Critical Hit", Count: 1, Value: 1200}) || main.Rolled[2] != (upgradeRolled{Name: "Critical Hit", Percent: true, Count: 1, Value: 12}) {
		t.Fatalf("rolled stats %+v", main.Rolled)
	}
	if earring := ref.Slots[1]; earring.RolledItems != 0 || earring.Rolled == nil || len(earring.Rolled) != 0 {
		t.Fatalf("earrings' rolled stats %+v", earring.Rolled)
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

// rankOf saves a character's row among the top players: with gear (a build) unless built is false.
func rankOf(t *testing.T, app core.App, n int, class string, power int64, built bool, values map[string]any) {
	t.Helper()
	record := map[string]any{"region": "eu", "serverId": 2304, "characterId": fmt.Sprintf("AAAAAAAAAAAAAAAAAAAAA%03d", n), "name": fmt.Sprintf("Hero%d", n), "class": class, "level": 45,
		"combatPower": power, "itemLevel": power / 100, "checkedAt": now()}
	if built {
		record["builtAt"] = now()
		record["build"] = map[string]any{"v": armoryVersion, "name": fmt.Sprintf("Hero%d", n), "class": class, "gear": []any{map[string]any{"slot": "MainHand", "name": "Rod", "grade": "Unique", "enchant": 10, "exceed": 0}},
			"boards": []any{}, "skills": []any{}}
	}
	for k, v := range values {
		record[k] = v
	}
	saved(t, app, "armory_ranks", record)
}

// The route compares the strongest characters of the class the armory knows the gear of, hidden
// ones and the character it is for left out, and lists the strongest 20 of them by name.
func TestUpgradesRouteComparesTheStrongestOfAClass(t *testing.T) {
	app := newTestApp(t)
	for n := 1; n <= 22; n++ {
		rankOf(t, app, n, "Chanter", int64(n)*10000, true, nil)
	}
	rankOf(t, app, 23, "Chanter", 400000, true, map[string]any{"hidden": true})
	rankOf(t, app, 24, "Chanter", 500000, false, nil)
	rankOf(t, app, 25, "Cleric", 900000, true, nil)
	body, headers := fetch(t, app, "/api/odyle/armory/upgrades/Chanter", 200)
	var ref upgradeReference
	if err := json.Unmarshal(body, &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Sample != 22 || len(ref.Players) != upgradeShown || ref.Players[0].Name != "Hero22" || ref.Players[0].CombatPower != 220000 || ref.Players[0].Server != "Lumiel" || ref.Players[0].Region != "eu" ||
		len(ref.CombatPowers) != 22 || ref.CombatPowers[21] != 10000 || ref.CombatPower.High != 220000 {
		t.Fatalf("reference %+v", ref)
	}
	if len(ref.Slots) != 1 || ref.Slots[0].Players != 22 || ref.Slots[0].Popular[0].Name != "Rod" || headers.Get("Cache-Control") != "public, max-age=300" {
		t.Fatalf("slots %+v, %v", ref.Slots, headers)
	}
	// The character the comparison is for is not one of the strongest it is compared with.
	without := ask(t, app, "GET", "/api/odyle/armory/upgrades/Chanter?serverId=2304&characterId=AAAAAAAAAAAAAAAAAAAAA022", nil, "", 200)
	if without["sample"].(float64) != 21 || without["players"].([]any)[0].(map[string]any)["name"] != "Hero21" {
		t.Fatalf("without itself: %v %v", without["sample"], without["players"].([]any)[0])
	}
	// Kept for everyone a while: a stronger character joins once it is worked out again.
	rankOf(t, app, 26, "Chanter", 600000, true, nil)
	if again := ask(t, app, "GET", "/api/odyle/armory/upgrades/Chanter", nil, "", 200); again["sample"].(float64) != 22 {
		t.Fatalf("worked out again at once: %v", again["sample"])
	}
	cache := stateOf(app).upgrades
	kept := cache.kept["Chanter|"]
	kept.at = time.Now().Add(-upgradeKeep)
	cache.kept["Chanter|"] = kept
	if again := ask(t, app, "GET", "/api/odyle/armory/upgrades/Chanter", nil, "", 200); again["sample"].(float64) != 23 || again["players"].([]any)[0].(map[string]any)["name"] != "Hero26" {
		t.Fatalf("not worked out again: %v", again["sample"])
	}
	// A class the armory knows nobody of compares with nobody, and is not kept.
	if none := ask(t, app, "GET", "/api/odyle/armory/upgrades/Templar", nil, "", 200); none["sample"].(float64) != 0 || len(none["players"].([]any)) != 0 || len(none["slots"].([]any)) != 0 {
		t.Fatalf("nobody: %v", none)
	}
	if _, kept := cache.kept["Templar|"]; kept {
		t.Fatal("an empty comparison is kept")
	}
	ask(t, app, "GET", "/api/odyle/armory/upgrades/%3Cb%3E", nil, "", 404)
}
