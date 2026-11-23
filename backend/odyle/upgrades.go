package odyle

import (
	"cmp"
	lru "container/list"
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory's Upgrade tab (src/upgrade.js): what the strongest characters of a class wear,
// slot by slot, so a player sees where their own gear falls furthest behind and what the
// strongest wear there instead, how far they enchant it and where it comes from. PLAYNC's
// Global pages list no rankings (docs/armory.md), so the strongest are the characters of the
// class with the most combat power the armory knows the gear of (armory_ranks, ranks.go): those
// readers opened and those the scout found (scout.go), from every Global region. No player types
// anything in (R1).
//
// A class's comparison is worked out from their builds, one at a time, at most every upgradeKeep
// and kept for everyone; a character among the strongest is compared with the others.
//
// Beside the strongest, a character can be compared with the next step: the characters of its
// class a little stronger than it (upgradeNextLow to upgradeNextHigh times its combat power, the
// upgradeNextSample nearest), whose gear the scout reads below the top too (scout.go). Characters
// whose combat power is far above what their item level gives (upgradeOddPower times their
// group's median of combat power per item level; PLAYNC lists a few such, 397,228 combat power at
// item level 861, say) are left out of either comparison, so their gear does not count as the
// strongest's.

const (
	upgradeSample     = rankLimit        // the strongest characters of a class compared with
	upgradeShown      = 20               // of them listed by name
	upgradeKeep       = 10 * time.Minute // a class's comparison is worked out again after
	upgradePopular    = 3                // items listed for a slot, most worn first
	upgradeLadder     = 8                // items of a slot's ladder, most worn first
	upgradeRolls      = 8                // rolled stats listed for a slot, most rolled first
	upgradeNextSample = 100              // characters of the next step compared with, nearest first
	upgradeNextLeast  = 10               // fewer of the next step and the strongest are compared instead
	upgradeOddPower   = 1.5              // combat power per item level past their median this many times is left out
)

// The next step's combat power: a band of characters' combat power (upgradeBandStep apart, so the
// characters of one band share a comparison) and the range above it compared with.
const (
	upgradeBandStep = 1.05
	upgradeNextLow  = 1.05 // times the band's top: the next step starts above the character
	upgradeNextHigh = 2.0  // times the band's top: where it ends
)

// upgradeSlots is the order of the slots compared: the paper doll's (src/armory.js). A
// character's two earrings, rings, bracelets and runes count as one slot each; the arcana keep
// their places, which hold arcana of their own kinds.
var upgradeSlots = []string{"MainHand", "SubHand", "Helmet", "Shoulder", "Torso", "Pants", "Gloves", "Boots", "Cape", "Belt",
	"Necklace", "Amulet", "Earring", "Ring", "Bracelet", "Rune", "Arcana1", "Arcana2", "Arcana3", "Arcana4", "Arcana5", "Wings"}

var pairedSlot = regexp.MustCompile(`^(Earring|Ring|Bracelet|Rune)\d+$`)

// upgradeSlot is the slot a piece of gear is compared in ("Earring2" → "Earring"), or "" for the
// pet, which has nothing to upgrade.
func upgradeSlot(slot string) string {
	if m := pairedSlot.FindStringSubmatch(slot); m != nil {
		return m[1]
	}
	if slot == "Pet" {
		return ""
	}
	return slot
}

// gradeRanks orders the grades from the most common up; Special (runes, events) stands apart.
var gradeRanks = map[string]int{"Common": 1, "Rare": 2, "Legend": 3, "Unique": 4, "Epic": 5, "Mythic": 6}

// upgradeReference is what the strongest characters of a class wear, as the Upgrade tab reads it.
type upgradeReference struct {
	Class        string          `json:"class"`
	Group        string          `json:"group"`        // "top" (the strongest) or "next" (the next step)
	Excluded     int             `json:"excluded"`     // left out for a combat power their item level does not give
	Players      []upgradePlayer `json:"players"`      // the strongest upgradeShown
	Sample       int             `json:"sample"`       // how many were compared
	CombatPowers []int64         `json:"combatPowers"` // theirs, strongest first
	CombatPower  upgradeSpread   `json:"combatPower"`
	ItemLevel    upgradeSpread   `json:"itemLevel"`
	Slots        []upgradeGear   `json:"slots"`
	Sets         []upgradeSet    `json:"sets"`
	Boards       []upgradeBoard  `json:"boards"`
	Skills       []upgradeSkill  `json:"skills"`
	// The skills the characters' arcana and their other gear raise, summed per character: how many
	// of them raise each and by how much (the median), of those whose arcana or gear raise any
	// (ArcanaPlayers, GearPlayers; builds kept before 1.1.0 left them out).
	ArcanaPlayers int            `json:"arcanaPlayers"`
	ArcanaSkills  []upgradeBoost `json:"arcanaSkills"`
	GearPlayers   int            `json:"gearPlayers"`
	GearSkills    []upgradeBoost `json:"gearSkills"`
	BuiltAt       string         `json:"builtAt"`
}

// A character of the comparison, strongest first, as the tab links its profile.
type upgradePlayer struct {
	Name        string `json:"name"`
	Level       int64  `json:"level"`
	Server      string `json:"server"`
	Region      string `json:"region"`
	ServerId    int    `json:"serverId"`
	CharacterId string `json:"characterId"`
	CombatPower int64  `json:"combatPower"`
	ItemLevel   int64  `json:"itemLevel"`
	Portrait    string `json:"portrait"`
}

// upgradeSpread is the median, lowest and highest of a number among the characters compared.
type upgradeSpread struct {
	Median int64 `json:"median"`
	Low    int64 `json:"low"`
	High   int64 `json:"high"`
}

// upgradeGear is one slot: how many of the characters wear something there, its usual grade, the
// medians of its item level, enchantment, exceed level and stones, the items worn most, the stones
// engraved most and the stats rolled most on its items.
type upgradeGear struct {
	Slot       string        `json:"slot"`
	Players    int           `json:"players"`
	Items      int           `json:"items"` // two of a character for earrings, rings, bracelets and runes
	Grade      string        `json:"grade"`
	ItemLevel  int64         `json:"itemLevel"` // of the items whose details PLAYNC gave, like the stones
	Enchant    int64         `json:"enchant"`
	Exceed     int64         `json:"exceed"`
	Stones     int64         `json:"stones"`
	StoneSlots int64         `json:"stoneSlots"`
	Popular    []upgradeItem `json:"popular"`
	// The items worn by more than one of the characters (upgradeLadder of them, most worn first),
	// the highest item level first: the rungs from one item to the next.
	Ladder     []upgradeItem `json:"ladder"`
	StoneNames []upgradeName `json:"stoneNames"`
	StoneGrade string        `json:"stoneGrade"` // the usual grade of the stones engraved, of those whose grade is known
	// The skills the slot's items raise (an arcana's four, a soul binding's), most raised first
	// (upgradeBoosts of them), of the items that raise any (BoostItems; builds kept before 1.1.0
	// left them out).
	BoostItems int            `json:"boostItems"`
	Boosts     []upgradeBoost `json:"boosts"`
	// The items whose rolled stats are known: those of builds kept before 0.64.0 are not.
	RolledItems int             `json:"rolledItems"`
	Rolled      []upgradeRolled `json:"rolled"`
}

// A stat rolled on the items of a slot (soul binding, PLAYNC's subStats): on how many of the items
// whose rolled stats are known, and its median on them; a share ("13%") or a number ("120").
type upgradeRolled struct {
	Name    string  `json:"name"`
	Percent bool    `json:"percent"`
	Count   int     `json:"count"`
	Value   float64 `json:"value"`
}

// rolledNumber is the number in a rolled stat's value as PLAYNC writes it ("13%", "+120", "1,200").
var rolledNumber = regexp.MustCompile(`-?[\d,]*\d(?:\.\d+)?`)

// rolledValue reads a rolled stat's value: its number and whether it is a share.
func rolledValue(text string) (value float64, percent, ok bool) {
	found := rolledNumber.FindString(text)
	if found == "" {
		return 0, false, false
	}
	value, err := strconv.ParseFloat(strings.ReplaceAll(found, ",", ""), 64)
	return value, strings.Contains(text, "%"), err == nil
}

// An item worn in a slot: how many wear it, how far they enchant it (medians) and how far it
// goes, its set, its main stats (medians at the enchantment they have it at), and where it comes
// from as its item page says.
type upgradeItem struct {
	Name       string        `json:"name"`
	Grade      string        `json:"grade"`
	Icon       string        `json:"icon"`
	Category   string        `json:"category"`
	Count      int           `json:"count"`
	Enchant    int64         `json:"enchant"`
	Exceed     int64         `json:"exceed"`
	ItemLevel  int64         `json:"itemLevel"`
	MaxEnchant int64         `json:"maxEnchant"`
	MaxExceed  int64         `json:"maxExceed"`
	Set        string        `json:"set,omitempty"`
	Main       []upgradeStat `json:"main"`
	Sources    []string      `json:"sources"`
}

// A skill items raise (PLAYNC's subSkills): on how many items of a slot, or how many characters
// raise it with their arcana or their other gear, and by how much (the median: a slot's items' own
// levels, a character's levels summed).
type upgradeBoost struct {
	Name  string `json:"name"`
	Icon  string `json:"icon"`
	Count int    `json:"count"`
	Level int64  `json:"level"`
}

// boostTally counts the skills raised, in the order they first came up.
type boostTally struct {
	icons  map[string]string
	levels map[string][]int64
	order  []string
}

func (b *boostTally) add(name, icon string, level int64) {
	if b.levels == nil {
		b.icons, b.levels = map[string]string{}, map[string][]int64{}
	}
	if b.levels[name] == nil {
		b.order = append(b.order, name)
	}
	b.levels[name] = append(b.levels[name], level)
	if b.icons[name] == "" {
		b.icons[name] = icon
	}
}

// top is the n skills raised most often, the higher median level first of a tie.
func (b *boostTally) top(n int) []upgradeBoost {
	out := make([]upgradeBoost, 0, len(b.order))
	for _, name := range b.order {
		out = append(out, upgradeBoost{Name: name, Icon: b.icons[name], Count: len(b.levels[name]), Level: median(b.levels[name])})
	}
	slices.SortStableFunc(out, func(a, b upgradeBoost) int { return cmp.Or(b.Count-a.Count, cmp.Compare(b.Level, a.Level)) })
	return out[:min(n, len(out))]
}

// The skills listed: of a slot, and of the arcana or the other gear of the characters.
const (
	upgradeBoosts      = 8
	upgradeBoostsTotal = 24
)

// A main stat of an item (its value and what its enchantment and exceed level add, summed): the
// median on the items whose main stats are known (builds kept before 1.1.0 left them out).
type upgradeStat struct {
	Name    string  `json:"name"`
	Percent bool    `json:"percent"`
	Value   float64 `json:"value"`
}

// mainStats sums an item's main stats by name, a share and a number of one name apart, in the
// order they come: each line's value and extra (an exceed line has only its extra). A weapon's
// attack counts its upper value. src/upgrade.js reads the character's own items the same way.
func mainStats(lines []armoryLine) (map[string]float64, []string) {
	sums, order := map[string]float64{}, []string{}
	for _, line := range lines {
		if line.Name == "" {
			continue
		}
		value, percent, ok := rolledValue(line.Value)
		extra, extraPercent, extraOk := rolledValue(line.Extra)
		if !ok && !extraOk {
			continue
		}
		key := line.Name + "|" + strconv.FormatBool(percent || !ok && extraPercent)
		if _, seen := sums[key]; !seen {
			order = append(order, key)
		}
		if ok {
			sums[key] += value
		}
		if extraOk {
			sums[key] += extra
		}
	}
	return sums, order
}

type upgradeName struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// A set the characters wear pieces of (an arcana set, say): how many, the median of pieces, and
// what its pieces give, as a build that kept them says (builds kept before 1.1.0 left them out).
type upgradeSet struct {
	Name    string           `json:"name"`
	Players int              `json:"players"`
	Pieces  int64            `json:"pieces"`
	Bonuses []armorySetBonus `json:"bonuses"`
}

// A Daevanion board: the median of nodes the characters opened on it, of its total.
type upgradeBoard struct {
	Name    string `json:"name"`
	Players int    `json:"players"`
	Open    int64  `json:"open"`
	Total   int64  `json:"total"`
}

// A skill on the characters' skill bars: how many keep it there, at what level (median).
type upgradeSkill struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	Icon     string `json:"icon"`
	Players  int    `json:"players"`
	Level    int64  `json:"level"`
}

// median is the middle of the values (the upper one of an even count), 0 for none.
func median[T cmp.Ordered](values []T) T {
	if len(values) == 0 {
		var none T
		return none
	}
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	return sorted[len(sorted)/2]
}

func spread(values []int64) upgradeSpread {
	if len(values) == 0 {
		return upgradeSpread{}
	}
	return upgradeSpread{Median: median(values), Low: slices.Min(values), High: slices.Max(values)}
}

// counted keeps how often each name came up, in the order they first did.
type counted struct {
	counts map[string]int
	order  []string
}

func (c *counted) add(name string) {
	if c.counts == nil {
		c.counts = map[string]int{}
	}
	if c.counts[name] == 0 {
		c.order = append(c.order, name)
	}
	c.counts[name]++
}

// top is the n names counted most, ties in the order they first came up.
func (c *counted) top(n int) []upgradeName {
	out := make([]upgradeName, 0, len(c.order))
	for _, name := range c.order {
		out = append(out, upgradeName{Name: name, Count: c.counts[name]})
	}
	slices.SortStableFunc(out, func(a, b upgradeName) int { return b.Count - a.Count })
	return out[:min(n, len(out))]
}

func names(list []upgradeName) []string {
	out := make([]string, len(list))
	for i, n := range list {
		out[i] = n.Name
	}
	return out
}

// The tallies of one slot, of one item worn in it and of one stat rolled on its items.
type slotTally struct {
	players                                        map[int]bool
	items                                          int
	grades, stones, stoneGrades                    counted
	levels, enchants, exceeds, engraved, stoneRoom []int64
	worn                                           map[string]*itemTally
	order                                          []string
	rolledItems                                    int
	rolled                                         map[string]*rolledTally
	rolledOrder                                    []string
	boostItems                                     int
	boosts                                         boostTally
}

type rolledTally struct {
	stat   upgradeRolled
	values []float64
}

type itemTally struct {
	item                      upgradeItem
	levels, enchants, exceeds []int64
	sources                   counted
	main                      map[string][]float64 // by mainStats' key
	mainOrder                 []string
}

// usual is the grade most of the counted have, the higher one of a tie; "" for none.
func (c *counted) usual() string {
	out, best := "", 0
	for _, grade := range c.order {
		if n := c.counts[grade]; n > best || n == best && gradeRanks[grade] > gradeRanks[out] {
			out, best = grade, n
		}
	}
	return out
}

func (s *slotTally) add(player int, g armoryGear) {
	s.players[player] = true
	s.items++
	s.grades.add(g.Grade)
	s.enchants, s.exceeds = append(s.enchants, g.Enchant), append(s.exceeds, g.Exceed)
	// An item by name and grade: some come in two grades under one name (Noble Belt, Legend and Unique).
	key := g.Name + "|" + g.Grade
	worn := s.worn[key]
	if worn == nil {
		worn = &itemTally{item: upgradeItem{Name: g.Name, Grade: g.Grade, Icon: g.Icon, Sources: []string{}}}
		s.worn[key] = worn
		s.order = append(s.order, key)
	}
	worn.item.Count++
	worn.enchants, worn.exceeds = append(worn.enchants, g.Enchant), append(worn.exceeds, g.Exceed)
	if worn.item.Icon == "" {
		worn.item.Icon = g.Icon
	}
	d := g.Detail
	if d == nil {
		return
	}
	if d.ItemLevel > 0 {
		s.levels, worn.levels = append(s.levels, d.ItemLevel), append(worn.levels, d.ItemLevel)
	}
	if worn.item.Category == "" {
		worn.item.Category = d.Category
	}
	worn.item.MaxEnchant, worn.item.MaxExceed = max(worn.item.MaxEnchant, d.MaxEnchant), max(worn.item.MaxExceed, d.MaxExceed)
	if worn.item.Set == "" && d.Set != nil {
		worn.item.Set = d.Set.Name
	}
	for _, source := range d.Sources {
		worn.sources.add(source)
	}
	if d.StoneSlots > 0 {
		s.engraved, s.stoneRoom = append(s.engraved, int64(len(d.Stones))), append(s.stoneRoom, d.StoneSlots)
	}
	for _, stone := range d.Stones {
		s.stones.add(stone.Name)
		if stone.Grade != "" {
			s.stoneGrades.add(stone.Grade)
		}
	}
	s.addRolled(d.Sub)
	if len(d.SubSkills) > 0 {
		s.boostItems++
	}
	for _, raised := range d.SubSkills {
		if raised.Name != "" {
			s.boosts.add(raised.Name, raised.Icon, raised.Level)
		}
	}
	sums, order := mainStats(d.Main)
	for _, key := range order {
		if worn.main == nil {
			worn.main = map[string][]float64{}
		}
		if worn.main[key] == nil {
			worn.mainOrder = append(worn.mainOrder, key)
		}
		worn.main[key] = append(worn.main[key], sums[key])
	}
}

// stats are the medians of the item's main stats, in the order they first came; a stat only some
// of the items list (an exceed line) is left out below half of the items that list any.
func (w *itemTally) stats() []upgradeStat {
	out, most := []upgradeStat{}, 0
	for _, key := range w.mainOrder {
		most = max(most, len(w.main[key]))
	}
	for _, key := range w.mainOrder {
		values := w.main[key]
		if len(values)*2 < most {
			continue
		}
		name, percent, _ := strings.Cut(key, "|")
		out = append(out, upgradeStat{Name: name, Percent: percent == "true", Value: median(values)})
	}
	return out
}

// addRolled counts an item's rolled stats, a stat rolled twice on it once with both summed. An item
// without any counts as unknown: builds kept before 0.64.0 left them out.
func (s *slotTally) addRolled(lines []armoryLine) {
	sums, order := map[string]float64{}, []string{}
	for _, line := range lines {
		value, percent, ok := rolledValue(line.Value)
		if !ok || line.Name == "" {
			continue
		}
		key := line.Name + "|" + strconv.FormatBool(percent)
		if _, seen := sums[key]; !seen {
			order = append(order, key)
			if s.rolled[key] == nil {
				s.rolled[key] = &rolledTally{stat: upgradeRolled{Name: line.Name, Percent: percent}}
				s.rolledOrder = append(s.rolledOrder, key)
			}
		}
		sums[key] += value
	}
	if len(order) == 0 {
		return
	}
	s.rolledItems++
	for _, key := range order {
		s.rolled[key].values = append(s.rolled[key].values, sums[key])
	}
}

func (s *slotTally) gear(slot string) upgradeGear {
	out := upgradeGear{Slot: slot, Players: len(s.players), Items: s.items, Grade: s.grades.usual(), ItemLevel: median(s.levels), Enchant: median(s.enchants), Exceed: median(s.exceeds),
		Stones: median(s.engraved), StoneSlots: median(s.stoneRoom), Popular: []upgradeItem{}, Ladder: []upgradeItem{}, StoneNames: s.stones.top(5), StoneGrade: s.stoneGrades.usual(),
		BoostItems: s.boostItems, Boosts: s.boosts.top(upgradeBoosts)}
	worn := []upgradeItem{}
	for _, name := range s.order {
		w := s.worn[name]
		item := w.item
		item.Enchant, item.Exceed, item.ItemLevel = median(w.enchants), median(w.exceeds), median(w.levels)
		item.Sources, item.Main = names(w.sources.top(4)), w.stats()
		worn = append(worn, item)
	}
	slices.SortStableFunc(worn, func(a, b upgradeItem) int {
		return cmp.Or(b.Count-a.Count, cmp.Compare(b.ItemLevel, a.ItemLevel), cmp.Compare(gradeRanks[b.Grade], gradeRanks[a.Grade]))
	})
	out.Popular = slices.Clone(worn[:min(upgradePopular, len(worn))])
	// The ladder: the items more than one character wears (any, while fewer than ten wear
	// something here), most worn first, then by item level.
	for _, item := range worn {
		if len(out.Ladder) < upgradeLadder && (item.Count > 1 || s.items < 10) {
			out.Ladder = append(out.Ladder, item)
		}
	}
	slices.SortStableFunc(out.Ladder, func(a, b upgradeItem) int {
		return cmp.Or(cmp.Compare(b.ItemLevel, a.ItemLevel), cmp.Compare(gradeRanks[b.Grade], gradeRanks[a.Grade]), b.Count-a.Count)
	})
	out.RolledItems, out.Rolled = s.rolledItems, []upgradeRolled{}
	for _, key := range s.rolledOrder {
		r := s.rolled[key]
		stat := r.stat
		stat.Count, stat.Value = len(r.values), median(r.values)
		out.Rolled = append(out.Rolled, stat)
	}
	slices.SortStableFunc(out.Rolled, func(a, b upgradeRolled) int { return b.Count - a.Count })
	out.Rolled = out.Rolled[:min(upgradeRolls, len(out.Rolled))]
	return out
}

// upgradeTally counts what the strongest characters of a class wear, one character at a time
// (strongest first), so the comparison never holds more than one of their builds.
type upgradeTally struct {
	players  []upgradePlayer
	slots    map[string]*slotTally
	extra    []string // slots past upgradeSlots, in the order they came up
	sets     map[string]*setTally
	setOrder []string
	boards   map[string]*boardTally
	boardIds []string
	skills   map[string]*skillTally
	skillIds []string
	// The skills raised by the characters' arcana and other gear, each character's levels summed.
	arcana, gear               boostTally
	arcanaPlayers, gearPlayers int
}

type setTally struct {
	players int
	pieces  []int64
	bonuses []armorySetBonus
}

type boardTally struct {
	open  []int64
	total int64
}

type skillTally struct {
	skill  upgradeSkill
	levels []int64
}

func newUpgradeTally() *upgradeTally {
	return &upgradeTally{players: []upgradePlayer{}, slots: map[string]*slotTally{}, sets: map[string]*setTally{}, boards: map[string]*boardTally{}, skills: map[string]*skillTally{}}
}

// add counts a character: its gear by slot, the sets it wears pieces of, its Daevanion boards and
// the skills on its skill bar.
func (t *upgradeTally) add(player upgradePlayer, p *armoryProfile) {
	i := len(t.players)
	t.players = append(t.players, player)
	worn := map[string]int64{} // the sets this character wears pieces of
	for _, g := range p.Gear {
		slot := upgradeSlot(g.Slot)
		if slot == "" || g.Name == "" {
			continue
		}
		if t.slots[slot] == nil {
			t.slots[slot] = &slotTally{players: map[int]bool{}, worn: map[string]*itemTally{}, rolled: map[string]*rolledTally{}}
			if !slices.Contains(upgradeSlots, slot) {
				t.extra = append(t.extra, slot)
			}
		}
		t.slots[slot].add(i, g)
		if g.Detail != nil && g.Detail.Set != nil && g.Detail.Set.Name != "" {
			name := g.Detail.Set.Name
			if _, seen := worn[name]; !seen && t.sets[name] == nil {
				t.sets[name] = &setTally{}
				t.setOrder = append(t.setOrder, name)
			}
			worn[name] = max(worn[name], g.Detail.Set.Equipped)
			if len(g.Detail.Set.Bonuses) > 0 && t.sets[name].bonuses == nil {
				t.sets[name].bonuses = g.Detail.Set.Bonuses
			}
		}
	}
	for name, pieces := range worn {
		t.sets[name].players++
		t.sets[name].pieces = append(t.sets[name].pieces, pieces)
	}
	// The skills its arcana and its other gear raise, each summed.
	var arcana, gear boostTally
	for _, g := range p.Gear {
		if g.Detail == nil || upgradeSlot(g.Slot) == "" {
			continue
		}
		into := &gear
		if strings.HasPrefix(g.Slot, "Arcana") {
			into = &arcana
		}
		for _, raised := range g.Detail.SubSkills {
			if raised.Name != "" {
				into.add(raised.Name, raised.Icon, raised.Level)
			}
		}
	}
	for _, sum := range []struct {
		from    *boostTally
		into    *boostTally
		players *int
	}{{&arcana, &t.arcana, &t.arcanaPlayers}, {&gear, &t.gear, &t.gearPlayers}} {
		if len(sum.from.order) > 0 {
			*sum.players++
		}
		for _, name := range sum.from.order {
			var total int64
			for _, level := range sum.from.levels[name] {
				total += level
			}
			sum.into.add(name, sum.from.icons[name], total)
		}
	}
	for _, b := range p.Boards {
		if b.Name == "" {
			continue
		}
		if t.boards[b.Name] == nil {
			t.boards[b.Name] = &boardTally{}
			t.boardIds = append(t.boardIds, b.Name)
		}
		t.boards[b.Name].open = append(t.boards[b.Name].open, b.Open)
		t.boards[b.Name].total = max(t.boards[b.Name].total, b.Total)
	}
	for _, s := range p.Skills {
		if !s.Equipped || s.Name == "" {
			continue
		}
		if t.skills[s.Name] == nil {
			t.skills[s.Name] = &skillTally{skill: upgradeSkill{Name: s.Name, Category: s.Category, Icon: s.Icon}}
			t.skillIds = append(t.skillIds, s.Name)
		}
		t.skills[s.Name].skill.Players++
		t.skills[s.Name].levels = append(t.skills[s.Name].levels, s.Level)
	}
}

// reference is the comparison of the characters counted, as read at: the strongest upgradeShown
// of them by name, every one's combat power (strongest first), and what they wear; group names
// who they are and excluded how many were left out.
func (t *upgradeTally) reference(class, group string, excluded int, at time.Time) upgradeReference {
	players := slices.Clone(t.players)
	slices.SortStableFunc(players, func(a, b upgradePlayer) int { return cmp.Compare(b.CombatPower, a.CombatPower) })
	ref := upgradeReference{Class: class, Group: group, Excluded: excluded, Players: players[:min(upgradeShown, len(players))], Sample: len(players), CombatPowers: []int64{},
		Slots: []upgradeGear{}, Sets: []upgradeSet{}, Boards: []upgradeBoard{}, Skills: []upgradeSkill{}, BuiltAt: isoTime(at)}
	levels := []int64{}
	for _, p := range players {
		ref.CombatPowers, levels = append(ref.CombatPowers, p.CombatPower), append(levels, p.ItemLevel)
	}
	ref.CombatPower, ref.ItemLevel = spread(ref.CombatPowers), spread(levels)
	for _, slot := range append(slices.Clone(upgradeSlots), t.extra...) {
		if s := t.slots[slot]; s != nil {
			ref.Slots = append(ref.Slots, s.gear(slot))
		}
	}
	for _, name := range t.setOrder {
		if s := t.sets[name]; s.players > 0 {
			bonuses := s.bonuses
			if bonuses == nil {
				bonuses = []armorySetBonus{}
			}
			ref.Sets = append(ref.Sets, upgradeSet{Name: name, Players: s.players, Pieces: median(s.pieces), Bonuses: bonuses})
		}
	}
	slices.SortStableFunc(ref.Sets, func(a, b upgradeSet) int { return cmp.Or(b.Players-a.Players, cmp.Compare(b.Pieces, a.Pieces)) })
	ref.Sets = ref.Sets[:min(8, len(ref.Sets))]
	for _, name := range t.boardIds {
		ref.Boards = append(ref.Boards, upgradeBoard{Name: name, Players: len(t.boards[name].open), Open: median(t.boards[name].open), Total: t.boards[name].total})
	}
	for _, name := range t.skillIds {
		s := t.skills[name].skill
		s.Level = median(t.skills[name].levels)
		ref.Skills = append(ref.Skills, s)
	}
	slices.SortStableFunc(ref.Skills, func(a, b upgradeSkill) int { return cmp.Or(b.Players-a.Players, cmp.Compare(b.Level, a.Level)) })
	ref.Skills = ref.Skills[:min(24, len(ref.Skills))]
	ref.ArcanaPlayers, ref.ArcanaSkills = t.arcanaPlayers, t.arcana.top(upgradeBoostsTotal)
	ref.GearPlayers, ref.GearSkills = t.gearPlayers, t.gear.top(upgradeBoostsTotal)
	return ref
}

// compareUpgrades is the comparison of the characters given, strongest first, as read at.
func compareUpgrades(class string, players []upgradePlayer, profiles []armoryProfile, at time.Time) upgradeReference {
	t := newUpgradeTally()
	for i := range players {
		t.add(players[i], &profiles[i])
	}
	return t.reference(class, "top", 0, at)
}

// upgradeAsk is a comparison asked for: the strongest of a class, without one of them (serverId,
// characterId; nobody when 0), or with band the next step of the characters of that band of
// combat power (upgradeBand).
type upgradeAsk struct {
	class       string
	serverId    int
	characterId string
	band        int
}

// key is the comparison's place in the cache.
func (a upgradeAsk) key() string {
	switch {
	case a.band > 0:
		return a.class + "|next|" + strconv.Itoa(a.band)
	case a.characterId != "":
		return a.class + "|" + armoryKey(a.serverId, a.characterId)
	}
	return a.class + "|"
}

// upgradeBand is the band of a combat power, its logarithm in upgradeBandStep rounded down (from
// 1 up): the characters of one band share the comparison with their next step.
func upgradeBand(power int64) int {
	return max(1, int(math.Floor(math.Log(float64(max(power, 1)))/math.Log(upgradeBandStep))))
}

// nextRange is the combat power the next step of a band starts and ends at: from upgradeNextLow
// times the band's top (so every character of the band is weaker) to upgradeNextHigh times it.
func nextRange(band int) (low, high int64) {
	top := math.Pow(upgradeBandStep, float64(band+1))
	return int64(math.Ceil(top * upgradeNextLow)), int64(top * upgradeNextHigh)
}

// upgradeOddRoom is how many characters past the sample a comparison reads at most to make up for
// those it leaves out.
const upgradeOddRoom = 50

// buildUpgrades works out a comparison (upgradeAsk) from the characters of the class the armory
// knows the gear of (armory_ranks, ranks.go): the strongest upgradeSample, or the upgradeNextSample
// nearest of the next step; without the character asked to leave out and those whose combat power
// their item level does not give (upgradeOddPower). It names those it compared.
func buildUpgrades(app core.App, ask upgradeAsk) (upgradeReference, map[string]bool, error) {
	where, order, sample, group := "class = {:class} AND hidden = FALSE AND builtAt != ''", "combatPower DESC, id", upgradeSample, "top"
	params := dbx.Params{"class": ask.class}
	if ask.band > 0 {
		low, high := nextRange(ask.band)
		where += " AND combatPower >= {:low} AND combatPower <= {:high}"
		order, sample, group, params["low"], params["high"] = "combatPower, id", upgradeNextSample, "next", low, high
	}
	params["limit"] = sample + 1 + upgradeOddRoom
	// The median of combat power per item level of those read, to leave out the odd ones.
	powers := []struct {
		CombatPower int64 `db:"combatPower"`
		ItemLevel   int64 `db:"itemLevel"`
	}{}
	if err := app.DB().NewQuery("SELECT combatPower, itemLevel FROM armory_ranks WHERE " + where + " ORDER BY " + order + " LIMIT {:limit}").Bind(params).All(&powers); err != nil {
		return upgradeReference{}, nil, err
	}
	ratios := []float64{}
	for _, p := range powers {
		if p.ItemLevel > 0 {
			ratios = append(ratios, float64(p.CombatPower)/float64(p.ItemLevel))
		}
	}
	odd := median(ratios) * upgradeOddPower
	rows, err := app.DB().NewQuery("SELECT region, serverId, characterId, name, level, combatPower, itemLevel, portrait, COALESCE(CAST(build AS TEXT), '') FROM armory_ranks WHERE " + where + " ORDER BY " + order + " LIMIT {:limit}").
		Bind(params).Rows()
	if err != nil {
		return upgradeReference{}, nil, err
	}
	defer rows.Close()
	t, members, book, excluded := newUpgradeTally(), map[string]bool{}, serversOf(app), 0
	for rows.Next() && len(t.players) < sample {
		var player upgradePlayer
		var build string
		if err := rows.Scan(&player.Region, &player.ServerId, &player.CharacterId, &player.Name, &player.Level, &player.CombatPower, &player.ItemLevel, &player.Portrait, &build); err != nil {
			return upgradeReference{}, nil, err
		}
		if player.ServerId == ask.serverId && player.CharacterId == ask.characterId {
			continue
		}
		if player.ItemLevel > 0 && odd > 0 && float64(player.CombatPower)/float64(player.ItemLevel) > odd {
			excluded++
			continue
		}
		var p armoryProfile
		if json.Unmarshal([]byte(build), &p) != nil || len(p.Gear) == 0 {
			continue
		}
		player.Server = book.name(player.ServerId)
		members[armoryKey(player.ServerId, player.CharacterId)] = true
		t.add(player, &p)
	}
	if err := rows.Err(); err != nil {
		return upgradeReference{}, nil, err
	}
	return t.reference(ask.class, group, excluded, time.Now()), members, nil
}

// knownPower is the combat power the armory knows of a character of a class, 0 for none.
func knownPower(app core.App, class string, serverId int, characterId string) int64 {
	var power int64
	_ = app.DB().NewQuery("SELECT combatPower FROM armory_ranks WHERE serverId = {:server} AND characterId = {:id} AND class = {:class}").
		Bind(dbx.Params{"server": serverId, "id": characterId, "class": class}).Row(&power)
	return power
}

// upgradeCache keeps each class's comparison for upgradeKeep, and for a character among the
// strongest the comparison without it, upgradeCached of them at most: when full, a class
// without anyone to compare goes first, then the one read longest ago. A comparison is worked
// out once however many ask for it meanwhile (they wait for it), and a class without anyone to
// compare is kept too, for upgradeEmptyKeep, so asking again reads nothing.
type upgradeCache struct {
	mu      sync.Mutex
	kept    map[string]*lru.Element // key → its place in order
	order   *lru.List               // of *upgradeEntry, the one read last first
	working map[string]*upgradeWork // comparisons being worked out, by key
}

type upgradeKept struct {
	ref     upgradeReference
	members map[string]bool // the characters compared (armoryKey)
	at      time.Time
}

type upgradeEntry struct {
	key  string
	kept upgradeKept
}

// upgradeWork is a comparison being worked out; done closes once kept and err are set.
type upgradeWork struct {
	done chan struct{}
	kept upgradeKept
	err  error
}

const (
	upgradeCached    = 256         // comparisons kept at most
	upgradeEmptyKeep = time.Minute // a class without anyone to compare is asked again after
)

func newUpgradeCache() *upgradeCache {
	return &upgradeCache{kept: map[string]*lru.Element{}, order: lru.New(), working: map[string]*upgradeWork{}}
}

// of is the comparison for a character of the class: with next, its next step while the armory
// knows the character's combat power and at least upgradeNextLeast of the next step; else the
// class's strongest, or, when the character is one of them, the strongest without it.
func (c *upgradeCache) of(app core.App, class string, serverId int, characterId string, next bool) (upgradeReference, error) {
	if next {
		if power := knownPower(app, class, serverId, characterId); power > 0 {
			kept, err := c.read(app, upgradeAsk{class: class, band: upgradeBand(power)})
			if err != nil || kept.ref.Sample >= upgradeNextLeast {
				return kept.ref, err
			}
		}
	}
	kept, err := c.read(app, upgradeAsk{class: class})
	if err != nil || !kept.members[armoryKey(serverId, characterId)] {
		return kept.ref, err
	}
	kept, err = c.read(app, upgradeAsk{class: class, serverId: serverId, characterId: characterId})
	return kept.ref, err
}

// fresh says whether a kept comparison may still be given.
func (k upgradeKept) fresh() bool {
	keep := upgradeKeep
	if k.ref.Sample == 0 {
		keep = upgradeEmptyKeep
	}
	return time.Since(k.at) < keep
}

func (c *upgradeCache) read(app core.App, ask upgradeAsk) (upgradeKept, error) {
	key := ask.key()
	c.mu.Lock()
	if el, ok := c.kept[key]; ok {
		if entry := el.Value.(*upgradeEntry); entry.kept.fresh() {
			c.order.MoveToFront(el)
			c.mu.Unlock()
			return entry.kept, nil
		}
	}
	if work, ok := c.working[key]; ok {
		c.mu.Unlock()
		<-work.done
		return work.kept, work.err
	}
	work := &upgradeWork{done: make(chan struct{})}
	c.working[key] = work
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.working, key)
		if work.err == nil {
			c.keep(key, work.kept)
		}
		c.mu.Unlock()
		close(work.done)
	}()
	work.err = unavailable("Many lookups at the moment. Try again in a minute.") // what those waiting hear should it panic
	ref, members, err := workOutUpgrades(app, ask)
	work.kept, work.err = upgradeKept{ref: ref, members: members, at: time.Now()}, err
	return work.kept, err
}

// workOutUpgrades works a comparison out (buildUpgrades; tests count the calls).
var workOutUpgrades = buildUpgrades

// keep keeps a comparison (with c.mu held), making room when full.
func (c *upgradeCache) keep(key string, kept upgradeKept) {
	if el, ok := c.kept[key]; ok {
		el.Value.(*upgradeEntry).kept = kept
		c.order.MoveToFront(el)
		return
	}
	if c.order.Len() >= upgradeCached {
		victim := c.order.Back()
		for el := c.order.Back(); el != nil; el = el.Prev() {
			if el.Value.(*upgradeEntry).kept.ref.Sample == 0 {
				victim = el
				break
			}
		}
		delete(c.kept, victim.Value.(*upgradeEntry).key)
		c.order.Remove(victim)
	}
	c.kept[key] = c.order.PushFront(&upgradeEntry{key: key, kept: kept})
}

// A class as PLAYNC names it (Chanter, Spiritmaster).
var upgradeClass = regexp.MustCompile(`^[A-Za-z][A-Za-z '-]{1,39}$`)

// upgradesRoute answers GET /api/odyle/armory/upgrades/{class}?serverId=&characterId=&group=: what
// the strongest characters of the class the armory knows the gear of wear, for the Upgrade tab of
// the profile the query names, which is left out of them; with group=next, what its next step
// wears (the strongest while the armory knows too few of it); nobody while the armory knows none
// of the class. Public; rate limited per address with the armory.
func upgradesRoute(e *core.RequestEvent) error {
	class, q := e.Request.PathValue("class"), e.Request.URL.Query()
	if !upgradeClass.MatchString(class) {
		return notFound("The armory keeps no character of that class.")
	}
	serverId, _ := strconv.Atoi(q.Get("serverId"))
	ref, err := stateOf(e.App).upgrades.of(e.App, class, serverId, q.Get("characterId"), q.Get("group") == "next")
	if err != nil {
		return err
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=300")
	return e.JSON(200, ref)
}
