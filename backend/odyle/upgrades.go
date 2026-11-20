package odyle

import (
	"cmp"
	"encoding/json"
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

const (
	upgradeSample  = rankLimit        // the strongest characters of a class compared with
	upgradeShown   = 20               // of them listed by name
	upgradeKeep    = 10 * time.Minute // a class's comparison is worked out again after
	upgradePopular = 3                // items listed for a slot, most worn first
	upgradeRolls   = 8                // rolled stats listed for a slot, most rolled first
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
	Players      []upgradePlayer `json:"players"`      // the strongest upgradeShown
	Sample       int             `json:"sample"`       // how many were compared
	CombatPowers []int64         `json:"combatPowers"` // theirs, strongest first
	CombatPower  upgradeSpread   `json:"combatPower"`
	ItemLevel    upgradeSpread   `json:"itemLevel"`
	Slots        []upgradeGear   `json:"slots"`
	Sets         []upgradeSet    `json:"sets"`
	Boards       []upgradeBoard  `json:"boards"`
	Skills       []upgradeSkill  `json:"skills"`
	BuiltAt      string          `json:"builtAt"`
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
	StoneNames []upgradeName `json:"stoneNames"`
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

// An item worn in a slot: how many wear it, how far they enchant it (medians), and where it
// comes from as its item page says.
type upgradeItem struct {
	Name      string   `json:"name"`
	Grade     string   `json:"grade"`
	Icon      string   `json:"icon"`
	Category  string   `json:"category"`
	Count     int      `json:"count"`
	Enchant   int64    `json:"enchant"`
	Exceed    int64    `json:"exceed"`
	ItemLevel int64    `json:"itemLevel"`
	Sources   []string `json:"sources"`
}

type upgradeName struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// A set the characters wear pieces of (an arcana set, say): how many, and the median of pieces.
type upgradeSet struct {
	Name    string `json:"name"`
	Players int    `json:"players"`
	Pieces  int64  `json:"pieces"`
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
	grades, stones                                 counted
	levels, enchants, exceeds, engraved, stoneRoom []int64
	worn                                           map[string]*itemTally
	order                                          []string
	rolledItems                                    int
	rolled                                         map[string]*rolledTally
	rolledOrder                                    []string
}

type rolledTally struct {
	stat   upgradeRolled
	values []float64
}

type itemTally struct {
	item                      upgradeItem
	levels, enchants, exceeds []int64
	sources                   counted
}

func (s *slotTally) add(player int, g armoryGear) {
	s.players[player] = true
	s.items++
	s.grades.add(g.Grade)
	s.enchants, s.exceeds = append(s.enchants, g.Enchant), append(s.exceeds, g.Exceed)
	worn := s.worn[g.Name]
	if worn == nil {
		worn = &itemTally{item: upgradeItem{Name: g.Name, Grade: g.Grade, Icon: g.Icon, Sources: []string{}}}
		s.worn[g.Name] = worn
		s.order = append(s.order, g.Name)
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
	for _, source := range d.Sources {
		worn.sources.add(source)
	}
	if d.StoneSlots > 0 {
		s.engraved, s.stoneRoom = append(s.engraved, int64(len(d.Stones))), append(s.stoneRoom, d.StoneSlots)
	}
	for _, stone := range d.Stones {
		s.stones.add(stone.Name)
	}
	s.addRolled(d.Sub)
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
	out := upgradeGear{Slot: slot, Players: len(s.players), Items: s.items, ItemLevel: median(s.levels), Enchant: median(s.enchants), Exceed: median(s.exceeds),
		Stones: median(s.engraved), StoneSlots: median(s.stoneRoom), Popular: []upgradeItem{}, StoneNames: s.stones.top(5)}
	// The usual grade: the one most items have, the higher one of a tie.
	best := 0
	for _, grade := range s.grades.order {
		if n := s.grades.counts[grade]; n > best || n == best && gradeRanks[grade] > gradeRanks[out.Grade] {
			out.Grade, best = grade, n
		}
	}
	for _, name := range s.order {
		worn := s.worn[name]
		item := worn.item
		item.Enchant, item.Exceed, item.ItemLevel = median(worn.enchants), median(worn.exceeds), median(worn.levels)
		item.Sources = names(worn.sources.top(4))
		out.Popular = append(out.Popular, item)
	}
	slices.SortStableFunc(out.Popular, func(a, b upgradeItem) int {
		return cmp.Or(b.Count-a.Count, cmp.Compare(b.ItemLevel, a.ItemLevel), cmp.Compare(gradeRanks[b.Grade], gradeRanks[a.Grade]))
	})
	out.Popular = out.Popular[:min(upgradePopular, len(out.Popular))]
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
}

type setTally struct {
	players int
	pieces  []int64
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
		}
	}
	for name, pieces := range worn {
		t.sets[name].players++
		t.sets[name].pieces = append(t.sets[name].pieces, pieces)
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
// of them by name, every one's combat power, and what they wear.
func (t *upgradeTally) reference(class string, at time.Time) upgradeReference {
	ref := upgradeReference{Class: class, Players: t.players[:min(upgradeShown, len(t.players))], Sample: len(t.players), CombatPowers: []int64{},
		Slots: []upgradeGear{}, Sets: []upgradeSet{}, Boards: []upgradeBoard{}, Skills: []upgradeSkill{}, BuiltAt: isoTime(at)}
	levels := []int64{}
	for _, p := range t.players {
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
			ref.Sets = append(ref.Sets, upgradeSet{Name: name, Players: s.players, Pieces: median(s.pieces)})
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
	return ref
}

// compareUpgrades is the comparison of the characters given, strongest first, as read at.
func compareUpgrades(class string, players []upgradePlayer, profiles []armoryProfile, at time.Time) upgradeReference {
	t := newUpgradeTally()
	for i := range players {
		t.add(players[i], &profiles[i])
	}
	return t.reference(class, at)
}

// buildUpgrades compares the strongest characters of a class the armory knows the gear of
// (armory_ranks, ranks.go), up to upgradeSample of them, without the one left out (serverId,
// characterId; none when 0), and names those it compared.
func buildUpgrades(app core.App, class string, serverId int, characterId string) (upgradeReference, map[string]bool, error) {
	rows, err := app.DB().NewQuery("SELECT region, serverId, characterId, name, level, combatPower, itemLevel, portrait, COALESCE(CAST(build AS TEXT), '') FROM armory_ranks WHERE class = {:class} AND hidden = FALSE AND builtAt != '' ORDER BY combatPower DESC, id LIMIT {:limit}").
		Bind(dbx.Params{"class": class, "limit": upgradeSample + 1}).Rows()
	if err != nil {
		return upgradeReference{}, nil, err
	}
	defer rows.Close()
	t, members, book := newUpgradeTally(), map[string]bool{}, serversOf(app)
	for rows.Next() && len(t.players) < upgradeSample {
		var player upgradePlayer
		var build string
		if err := rows.Scan(&player.Region, &player.ServerId, &player.CharacterId, &player.Name, &player.Level, &player.CombatPower, &player.ItemLevel, &player.Portrait, &build); err != nil {
			return upgradeReference{}, nil, err
		}
		var p armoryProfile
		if player.ServerId == serverId && player.CharacterId == characterId || json.Unmarshal([]byte(build), &p) != nil || len(p.Gear) == 0 {
			continue
		}
		player.Server = book.name(player.ServerId)
		members[armoryKey(player.ServerId, player.CharacterId)] = true
		t.add(player, &p)
	}
	if err := rows.Err(); err != nil {
		return upgradeReference{}, nil, err
	}
	return t.reference(class, time.Now()), members, nil
}

// upgradeCache keeps each class's comparison for upgradeKeep, and for a character among the
// strongest the comparison without it.
type upgradeCache struct {
	mu   sync.Mutex
	kept map[string]upgradeKept
}

type upgradeKept struct {
	ref     upgradeReference
	members map[string]bool // the characters compared (armoryKey)
	at      time.Time
}

func newUpgradeCache() *upgradeCache { return &upgradeCache{kept: map[string]upgradeKept{}} }

// of is the comparison for a character of the class: the class's, or, when the character is one
// of the strongest, the one without it. Classes the armory knows no character of keep nothing.
func (c *upgradeCache) of(app core.App, class string, serverId int, characterId string) (upgradeReference, error) {
	kept, err := c.read(app, class+"|", class, 0, "")
	if err != nil || !kept.members[armoryKey(serverId, characterId)] {
		return kept.ref, err
	}
	kept, err = c.read(app, class+"|"+armoryKey(serverId, characterId), class, serverId, characterId)
	return kept.ref, err
}

func (c *upgradeCache) read(app core.App, key, class string, serverId int, characterId string) (upgradeKept, error) {
	c.mu.Lock()
	kept, ok := c.kept[key]
	c.mu.Unlock()
	if ok && time.Since(kept.at) < upgradeKeep {
		return kept, nil
	}
	ref, members, err := buildUpgrades(app, class, serverId, characterId)
	kept = upgradeKept{ref: ref, members: members, at: time.Now()}
	if err != nil || ref.Sample == 0 {
		return kept, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.kept) >= 256 {
		c.kept = map[string]upgradeKept{}
	}
	c.kept[key] = kept
	return kept, nil
}

// A class as PLAYNC names it (Chanter, Spiritmaster).
var upgradeClass = regexp.MustCompile(`^[A-Za-z][A-Za-z '-]{1,39}$`)

// upgradesRoute answers GET /api/odyle/armory/upgrades/{class}?serverId=&characterId=: what the
// strongest characters of the class the armory knows the gear of wear, for the Upgrade tab of the
// profile the query names, which is left out of them; nobody while the armory knows none of the
// class. Public; rate limited per address with the armory.
func upgradesRoute(e *core.RequestEvent) error {
	class, q := e.Request.PathValue("class"), e.Request.URL.Query()
	if !upgradeClass.MatchString(class) {
		return notFound("The armory keeps no character of that class.")
	}
	serverId, _ := strconv.Atoi(q.Get("serverId"))
	ref, err := stateOf(e.App).upgrades.of(e.App, class, serverId, q.Get("characterId"))
	if err != nil {
		return err
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=300")
	return e.JSON(200, ref)
}
