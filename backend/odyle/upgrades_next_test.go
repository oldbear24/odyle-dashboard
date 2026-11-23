package odyle

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// A slot's ladder lists the items worn by more than one of the characters (any while few wear
// something there), the highest item level first, each with how far it goes, its set and the
// medians of its main stats; the slot names the usual grade of its stones, and a set what its
// pieces give.
func TestUpgradesListEachSlotsLadder(t *testing.T) {
	rod := func(name string, level, enchant int64, attack, extra string) armoryGear {
		return gearOf("MainHand", name, "Unique", enchant, level, func(d *armoryItem) {
			d.MaxEnchant, d.MaxExceed, d.StoneSlots = 15, 5, 2
			d.Main = []armoryLine{{Name: "Attack", Value: attack, Extra: extra}, {Name: "Combat Speed", Value: "5%"}, {Name: "Attack", Value: "0", Extra: "40", Exceed: true}}
			d.Stones = []armoryStone{{Name: "Attack", Grade: "Unique"}, {Name: "Attack", Grade: "Legend"}}
		})
	}
	vigor := func(bonuses []armorySetBonus) func(*armoryItem) {
		return func(d *armoryItem) { d.Set = &armorySet{Name: "Primal Vigor", Equipped: 3, Bonuses: bonuses} }
	}
	bonus := []armorySetBonus{{Count: 2, Effects: []string{"Attack +5%"}}, {Count: 4, Effects: []string{"PvE Attack +60"}}}
	profiles := []armoryProfile{
		{Gear: []armoryGear{rod("Rod A", 102, 15, "630", "174"), gearOf("Arcana1", "Chalice of Vigor", "Unique", 4, 80, vigor([]armorySetBonus{}))}},
		{Gear: []armoryGear{rod("Rod A", 102, 13, "600", "150"), gearOf("Arcana1", "Chalice of Vigor", "Unique", 4, 80, vigor(bonus))}},
		{Gear: []armoryGear{rod("Rod B", 86, 15, "500", "174")}},
		{Gear: []armoryGear{{Slot: "MainHand", Name: "Rod C", Grade: "Legend", Enchant: 10}}},
	}
	players := []upgradePlayer{{Name: "A", CombatPower: 400}, {Name: "B", CombatPower: 300}, {Name: "C", CombatPower: 200}, {Name: "D", CombatPower: 100}}
	ref := compareUpgrades("Chanter", players, profiles, time.Now())
	main := ref.Slots[0]
	if len(main.Ladder) != 3 || main.Ladder[0].Name != "Rod A" || main.Ladder[1].Name != "Rod B" || main.Ladder[2].Name != "Rod C" {
		t.Fatalf("ladder %+v", main.Ladder)
	}
	a := main.Ladder[0]
	// Attack: 630 + 174 + the exceed line's 40, and 600 + 150 + 40; the median of two is the upper one.
	if a.Count != 2 || a.MaxEnchant != 15 || a.MaxExceed != 5 || len(a.Main) != 2 || a.Main[0] != (upgradeStat{Name: "Attack", Value: 844}) || a.Main[1] != (upgradeStat{Name: "Combat Speed", Percent: true, Value: 5}) {
		t.Fatalf("Rod A %+v", a)
	}
	if c := main.Ladder[2]; c.ItemLevel != 0 || len(c.Main) != 0 || c.Main == nil {
		t.Fatalf("an item without details %+v", c)
	}
	// Three Unique stones and three Legend ones: the higher grade of a tie.
	if main.StoneGrade != "Unique" {
		t.Fatalf("stone grade %q", main.StoneGrade)
	}
	if arcana := ref.Slots[1]; len(arcana.Ladder) != 1 || arcana.Ladder[0].Set != "Primal Vigor" {
		t.Fatalf("arcana %+v", arcana.Ladder)
	}
	if len(ref.Sets) != 1 || len(ref.Sets[0].Bonuses) != 2 || ref.Sets[0].Bonuses[1].Effects[0] != "PvE Attack +60" {
		t.Fatalf("sets %+v", ref.Sets)
	}
	// With ten or more items in a slot, an item one character wears is no rung.
	many, manyPlayers := []armoryProfile{}, []upgradePlayer{}
	for n := range 12 {
		name := "Rod A"
		if n == 0 {
			name = "Rod Odd"
		}
		many, manyPlayers = append(many, armoryProfile{Gear: []armoryGear{rod(name, 102, 15, "630", "174")}}), append(manyPlayers, upgradePlayer{CombatPower: int64(100 - n)})
	}
	if ladder := compareUpgrades("Chanter", manyPlayers, many, time.Now()).Slots[0].Ladder; len(ladder) != 1 || ladder[0].Name != "Rod A" {
		t.Fatalf("ladder of many %+v", ladder)
	}
}

// mainStats sums each stat's value and extra, a share and a number of one name apart, and an
// exceed line's extra; lines without a number are left out.
func TestMainStatsSumValueAndExtra(t *testing.T) {
	sums, order := mainStats([]armoryLine{{Name: "Attack", Value: "630", Extra: "174"}, {Name: "Attack", Extra: "40", Exceed: true}, {Name: "Attack", Value: "3%"}, {Name: "Odd", Value: "?"}, {Value: "5"}})
	if len(order) != 2 || order[0] != "Attack|false" || sums["Attack|false"] != 844 || sums["Attack|true"] != 3 {
		t.Fatalf("sums %v %v", sums, order)
	}
}

// cidOf is the PLAYNC id peerRow gives a character.
func cidOf(id string) string { return fmt.Sprintf("AAAAAAAAAAAAAAAAA%07s", id) }

// peerRow saves a character's row as the scout or a lookup would, with a small build.
func peerRow(t *testing.T, app core.App, id string, class string, level, power, itemLevel int64, builtAt string) {
	t.Helper()
	build := ""
	if builtAt != "" {
		raw, _ := json.Marshal(armoryProfile{Name: id, Class: class, Gear: []armoryGear{{Slot: "MainHand", Name: "Rod " + id, Grade: "Unique", Enchant: 10}}, Boards: []armoryBoard{}, Skills: []armorySkill{}})
		build = string(raw)
	}
	if _, err := app.DB().NewQuery("INSERT INTO armory_ranks (id, region, serverId, characterId, name, class, level, combatPower, itemLevel, checkedAt, builtAt, build, hidden) VALUES ({:id}, 'eu', 2304, {:cid}, {:name}, {:class}, {:level}, {:power}, {:il}, {:now}, {:built}, {:build}, FALSE)").
		Bind(dbx.Params{"id": fmt.Sprintf("%015s", id), "cid": cidOf(id), "name": id, "class": class, "level": level, "power": power, "il": itemLevel, "now": now(), "built": builtAt, "build": build}).Execute(); err != nil {
		t.Fatal(err)
	}
}

// With group=next a character is compared with the nearest characters of its class a little
// stronger than it, those whose combat power their item level does not give left out; with too
// few of them, or when the armory does not know its combat power, with the strongest.
func TestUpgradesCompareWithTheNextStep(t *testing.T) {
	app := newTestApp(t)
	built := now()
	peerRow(t, app, "me", "Chanter", 45, 50000, 500, "")
	low, high := nextRange(upgradeBand(50000))
	if low <= 50000*1.05 || low > 50000*1.11 || high < 50000*2 || high > 50000*2.11 || float64(high) > float64(low)/upgradeNextLow*upgradeNextHigh+1 {
		t.Fatalf("next step of 50,000: %d to %d", low, high)
	}
	for n := range 30 {
		peerRow(t, app, fmt.Sprint("n", n), "Chanter", 45, low+int64(n)*1000, (low+int64(n)*1000)/100, built)
	}
	peerRow(t, app, "odd", "Chanter", 45, low+500, 9, built)       // 7,000 combat power per item level
	peerRow(t, app, "far", "Chanter", 45, high+1, high/100, built) // past the next step
	peerRow(t, app, "weak", "Chanter", 45, 40000, 400, built)      // weaker
	peerRow(t, app, "cleric", "Cleric", 45, low+10, low/100, built)
	var ref upgradeReference
	body, _ := fetch(t, app, "/api/odyle/armory/upgrades/Chanter?serverId=2304&characterId="+cidOf("me")+"&group=next", 200)
	if err := json.Unmarshal(body, &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Group != "next" || ref.Sample != 30 || ref.Excluded != 1 || ref.CombatPower.Low != low || ref.CombatPower.High != low+29000 || ref.Players[0].Name != "n29" || len(ref.Players) != upgradeShown {
		t.Fatalf("next step: group %s, %d compared, %d left out, %+v, first %+v", ref.Group, ref.Sample, ref.Excluded, ref.CombatPower, ref.Players[0])
	}
	// The strongest by default, the odd one left out there too.
	body, _ = fetch(t, app, "/api/odyle/armory/upgrades/Chanter?serverId=2304&characterId="+cidOf("me"), 200)
	if err := json.Unmarshal(body, &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Group != "top" || ref.Sample != 32 || ref.Excluded != 1 || ref.Players[0].Name != "far" {
		t.Fatalf("strongest: group %s, %d compared, %d left out, first %+v", ref.Group, ref.Sample, ref.Excluded, ref.Players[0])
	}
	// Too few a step above the strongest of them: the strongest.
	peerRow(t, app, "high", "Chanter", 45, low+29500, (low+29500)/100, "")
	body, _ = fetch(t, app, "/api/odyle/armory/upgrades/Chanter?serverId=2304&characterId="+cidOf("high")+"&group=next", 200)
	if err := json.Unmarshal(body, &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Group != "top" || ref.Sample != 32 {
		t.Fatalf("too few a step above: group %s, %d compared", ref.Group, ref.Sample)
	}
	// A character the armory does not know: the strongest.
	body, _ = fetch(t, app, "/api/odyle/armory/upgrades/Chanter?serverId=2304&characterId=BBBBBBBBBBBBBBBBBBBBBBBB&group=next", 200)
	if err := json.Unmarshal(body, &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Group != "top" {
		t.Fatalf("unknown character: group %s", ref.Group)
	}
	// Characters of one band share the next step's comparison.
	if a, b := (upgradeAsk{class: "Chanter", band: upgradeBand(50000)}).key(), (upgradeAsk{class: "Chanter", band: upgradeBand(50100)}).key(); a != b {
		t.Fatalf("one band, two comparisons: %s %s", a, b)
	}
}

// Once no top character's gear is due, the scout reads the gear of characters below the top: of
// the class's highest level, a few of each band of combat power, the band with the fewest builds
// first; builds read lately (by readers' lookups too) count for their bands.
func TestScoutReadsTheGearBelowTheTop(t *testing.T) {
	app := newTestApp(t)
	recent, old := now(), stamp(time.Now().Add(-peerRebuild-time.Hour))
	err := app.RunInTransaction(func(tx core.App) error {
		for n := range rankLimit {
			peerRow(t, tx, fmt.Sprint("t", n), "Chanter", 45, 900000-int64(n), 9000, recent)
		}
		// Below the top: a band (around 100,000) with peerPerBand fresh builds, another (around
		// 50,000) with one fresh and two old, and a character of a lower level.
		for n := range peerPerBand {
			peerRow(t, tx, fmt.Sprint("full", n), "Chanter", 45, 100000+int64(n), 1000, recent)
		}
		peerRow(t, tx, "fullwait", "Chanter", 45, 100100, 1000, "")
		peerRow(t, tx, "half", "Chanter", 45, 50000, 500, recent)
		peerRow(t, tx, "halfold", "Chanter", 45, 50010, 500, old)
		peerRow(t, tx, "halfnew", "Chanter", 45, 50020, 500, "")
		peerRow(t, tx, "low", "Chanter", 40, 50030, 500, "")
		peerRow(t, tx, "alone", "Chanter", 45, 20000, 200, "")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if peerBandOf(100000) != peerBandOf(100100) || peerBandOf(50000) != peerBandOf(50020) || peerBandOf(50000) == peerBandOf(20000) {
		t.Fatal("bands")
	}
	peers, err := pendingPeers(app)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, p := range peers {
		var name string
		_ = app.DB().NewQuery("SELECT name FROM armory_ranks WHERE id = {:id}").Bind(dbx.Params{"id": p.Id}).Row(&name)
		names = append(names, name)
	}
	// The band without builds first, then the one with one; the full band and the lower level not at all.
	if fmt.Sprint(names) != "[alone halfnew halfold]" {
		t.Fatalf("peers %v", names)
	}
	// The top is fresh, so the scout's next builds are the peers.
	hits, err := nextBuilds(app)
	if err != nil || len(hits) != 3 || hits[0].characterId != cidOf("alone") {
		t.Fatalf("next builds %+v %v", hits, err)
	}
	if st := scoutStatus(app); st["peers"] != 3 || st["builds"] != 0 {
		t.Fatalf("status peers %v builds %v", st["peers"], st["builds"])
	}
}

// The skills items raise: per slot, on how many of its items and at what level; and per character,
// those its arcana and its other gear raise, summed, with how many raise each.
func TestUpgradesCountTheSkillsGearRaises(t *testing.T) {
	raises := func(slot, name string, skills ...armorySubSkill) armoryGear {
		return gearOf(slot, name, "Unique", 0, 80, func(d *armoryItem) { d.SubSkills = skills })
	}
	slam := func(level int64) armorySubSkill {
		return armorySubSkill{Name: "Overhead Slam", Level: level, Icon: "slam.png"}
	}
	blow := func(level int64) armorySubSkill { return armorySubSkill{Name: "Rending Blow", Level: level} }
	profiles := []armoryProfile{
		{Gear: []armoryGear{raises("Arcana1", "Chalice", slam(4), blow(2)), raises("Arcana2", "Parchment", slam(1)), raises("Ring1", "Ring", slam(1)), raises("Ring2", "Ring", blow(1))}},
		{Gear: []armoryGear{raises("Arcana1", "Chalice", slam(3)), raises("Ring1", "Ring")}},
		{Gear: []armoryGear{raises("Arcana1", "Chalice")}}, // a build kept before 1.1.0
	}
	players := []upgradePlayer{{CombatPower: 3}, {CombatPower: 2}, {CombatPower: 1}}
	ref := compareUpgrades("Gladiator", players, profiles, time.Now())
	var chalice upgradeGear
	for _, s := range ref.Slots {
		if s.Slot == "Arcana1" {
			chalice = s
		}
	}
	if chalice.Slot != "Arcana1" || chalice.BoostItems != 2 || len(chalice.Boosts) != 2 || chalice.Boosts[0] != (upgradeBoost{Name: "Overhead Slam", Icon: "slam.png", Count: 2, Level: 4}) || chalice.Boosts[1].Name != "Rending Blow" {
		t.Fatalf("arcana 1 %+v", chalice)
	}
	// Overhead Slam: 4 + 1 from the first's arcana, 3 from the second's.
	if ref.ArcanaPlayers != 2 || len(ref.ArcanaSkills) != 2 || ref.ArcanaSkills[0] != (upgradeBoost{Name: "Overhead Slam", Icon: "slam.png", Count: 2, Level: 5}) || ref.ArcanaSkills[1] != (upgradeBoost{Name: "Rending Blow", Count: 1, Level: 2}) {
		t.Fatalf("arcana skills %d %+v", ref.ArcanaPlayers, ref.ArcanaSkills)
	}
	if ref.GearPlayers != 1 || len(ref.GearSkills) != 2 || ref.GearSkills[0].Count != 1 || ref.GearSkills[0].Level != 1 {
		t.Fatalf("gear skills %d %+v", ref.GearPlayers, ref.GearSkills)
	}
}
