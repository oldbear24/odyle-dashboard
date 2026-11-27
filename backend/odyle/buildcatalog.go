package odyle

import (
	"cmp"
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// A class's catalog for builds (builds.go, src/builds.js): what a build of the class can hold,
// from what the armory keeps of the class and nothing asked of PLAYNC (R1). PLAYNC's Global pages
// list no item database, so the catalog is what the class's characters the armory knows wear:
//
//   - the Daevanion boards node by node, closed nodes included, from the profiles readers opened
//     (armory_profiles: a profile keeps every node of each board with any open; the boards of
//     several characters together fill those none of them opened);
//   - every skill of the class, as PLAYNC lists them for each character, with the highest level seen;
//   - per slot, the items worn there (their details: main stats with what an enchantment level and
//     an exceed level add, limits, set, stone slots, where they come from), the stones engraved,
//     the theostones, the soul binding's rolled stats and the skills the slot's items raise, from
//     the profiles and the builds of armory_ranks (the top players and those the scout read).
//
// A class's catalog is worked out at most every catalogKeep and kept in server memory for everyone.

const (
	catalogKeep      = 15 * time.Minute
	catalogEmptyKeep = time.Minute
	catalogProfiles  = 200 // full profiles read, newest first
	catalogBuilds    = 600 // builds of armory_ranks read besides, read last first
	catalogItems     = 60  // items listed per slot
	catalogStones    = 30  // stones, theostones, rolled stats and raised skills listed per slot
	catalogCached    = 32  // classes kept
)

// buildCatalog is a class's catalog.
type buildCatalog struct {
	Class      string         `json:"class"`
	Icon       string         `json:"icon,omitempty"` // the class's emblem (classes.go)
	Characters int            `json:"characters"`     // whose profiles or builds it was made from
	Boards     []catalogBoard `json:"boards"`
	Skills     []catalogSkill `json:"skills"`
	Slots      []catalogSlot  `json:"slots"`
	BuiltAt    string         `json:"builtAt"`
}

// A Daevanion board with every node the armory knows of it (Open always false).
type catalogBoard struct {
	Id    int64        `json:"id"`
	Name  string       `json:"name"`
	Icon  string       `json:"icon,omitempty"`
	Total int64        `json:"total"`
	Nodes []armoryNode `json:"nodes"`
}

// A skill of the class, the highest level seen, and how many keep it on their skill bars.
type catalogSkill struct {
	Name      string `json:"name"`
	Category  string `json:"category"`
	Icon      string `json:"icon,omitempty"`
	NeedLevel int64  `json:"needLevel"`
	MaxLevel  int64  `json:"maxLevel"`
	Bar       int    `json:"bar"`
}

// A slot of the catalog: the paper doll's, a character's two earrings, rings, bracelets and runes
// as one (upgradeSlot), the pet kept.
type catalogSlot struct {
	Slot   string          `json:"slot"`
	Items  []catalogItem   `json:"items"`
	Stones []catalogStone  `json:"stones"`
	Gods   []catalogStone  `json:"gods"`
	Rolled []catalogRolled `json:"rolled"`
	Boosts []catalogBoost  `json:"boosts"`
}

// An item worn in a slot, by name and grade. Main lists its main stats (Value and Min at no
// enchantment, PerEnchant what each enchantment level adds), Exceed what each exceed level adds.
type catalogItem struct {
	Name       string        `json:"name"`
	Grade      string        `json:"grade"`
	Icon       string        `json:"icon,omitempty"`
	Count      int           `json:"count"`
	Category   string        `json:"category,omitempty"`
	Kind       string        `json:"kind,omitempty"`
	ItemLevel  int64         `json:"itemLevel"`
	EquipLevel int64         `json:"equipLevel,omitempty"`
	MaxEnchant int64         `json:"maxEnchant"`
	MaxExceed  int64         `json:"maxExceed"`
	MaxLevel   int64         `json:"maxLevel,omitempty"` // a pet's
	Enchant    int64         `json:"enchant"`            // the median of those who wear it
	StoneSlots int64         `json:"stoneSlots"`
	GodSlots   int64         `json:"godSlots"`
	SubCount   int64         `json:"subCount"`
	Main       []catalogStat `json:"main"`
	Exceed     []catalogStat `json:"exceed"`
	Set        *armorySet    `json:"set,omitempty"`
	Sources    []string      `json:"sources"`
	Classes    []string      `json:"classes"`
	Race       string        `json:"race,omitempty"`
	Tradable   bool          `json:"tradable"`
}

type catalogStat struct {
	Name       string  `json:"name"`
	Percent    bool    `json:"percent"`
	Min        float64 `json:"min,omitempty"`
	Value      float64 `json:"value"`
	PerEnchant float64 `json:"perEnchant,omitempty"`
	PerLevel   float64 `json:"perLevel,omitempty"`
}

// A stone engraved in the slot's items (a manastone, a soulstone, a theostone), how often.
type catalogStone struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
	Grade string `json:"grade"`
	Desc  string `json:"desc,omitempty"`
	Icon  string `json:"icon,omitempty"`
	Count int    `json:"count"`
}

// A stat the soul binding of the slot's items rolls: how often, its lowest, median and highest.
type catalogRolled struct {
	Name    string  `json:"name"`
	Percent bool    `json:"percent"`
	Count   int     `json:"count"`
	Low     float64 `json:"low"`
	Value   float64 `json:"value"`
	High    float64 `json:"high"`
}

// A skill the slot's items raise: how often, its median and highest level.
type catalogBoost struct {
	Name  string `json:"name"`
	Icon  string `json:"icon,omitempty"`
	Count int    `json:"count"`
	Level int64  `json:"level"`
	High  int64  `json:"high"`
}

// catalogSlotOf is the catalog's slot of a piece of gear ("Earring2" → "Earring").
func catalogSlotOf(slot string) string {
	if m := pairedSlot.FindStringSubmatch(slot); m != nil {
		return m[1]
	}
	return slot
}

// catalogOrder is the order of the catalog's slots.
var catalogOrder = append(slices.Clone(upgradeSlots), "Pet")

// ---------------------------------------------------------------- tallies

type catalogTally struct {
	characters int
	boards     map[int64]*catalogBoardTally
	boardOrder []int64
	skills     map[string]*catalogSkillTally
	skillOrder []string
	slots      map[string]*catalogSlotTally
}

type catalogBoardTally struct {
	board catalogBoard
	nodes map[[2]int64]armoryNode
}

type catalogSkillTally struct {
	skill catalogSkill
}

type catalogSlotTally struct {
	items      map[string]*catalogItemTally
	itemOrder  []string
	stones     map[string]*catalogStone
	stoneOrder []string
	gods       map[string]*catalogStone
	godOrder   []string
	rolled     map[string]*catalogRolledValues
	rollOrder  []string
	boosts     map[string]*catalogBoostValues
	boostOrder []string
}

type catalogRolledValues struct {
	stat   catalogRolled
	values []float64
}

type catalogBoostValues struct {
	boost  catalogBoost
	levels []int64
}

type catalogItemTally struct {
	item          catalogItem
	levels        []int64
	enchants      []int64
	stoneSlots    []int64
	godSlots      []int64
	subCounts     []int64
	main          map[string]*catalogStatValues
	mainOrder     []string
	exceed        map[string]*catalogStatValues
	exceedOrder   []string
	sources       counted
	detailedSeen  int
	setItemsKnown bool
}

type catalogStatValues struct {
	stat              catalogStat
	mins, values, per []float64
}

func newCatalogTally() *catalogTally {
	return &catalogTally{boards: map[int64]*catalogBoardTally{}, skills: map[string]*catalogSkillTally{}, slots: map[string]*catalogSlotTally{}}
}

// addBoards adds a profile's boards: their names, totals and nodes (a cell the tally knows keeps
// what it knew first, from the newer profile).
func (t *catalogTally) addBoards(boards []armoryBoard) {
	for _, b := range boards {
		if b.Id <= 0 {
			continue
		}
		bt := t.boards[b.Id]
		if bt == nil {
			bt = &catalogBoardTally{board: catalogBoard{Id: b.Id, Name: b.Name, Icon: b.Icon}, nodes: map[[2]int64]armoryNode{}}
			t.boards[b.Id] = bt
			t.boardOrder = append(t.boardOrder, b.Id)
		}
		bt.board.Total = max(bt.board.Total, b.Total)
		if bt.board.Icon == "" {
			bt.board.Icon = b.Icon
		}
		for _, n := range b.Nodes {
			cell := [2]int64{n.Row, n.Col}
			if _, known := bt.nodes[cell]; known || n.Type == "" || n.Type == "None" {
				continue
			}
			n.Open = false
			bt.nodes[cell] = n
		}
	}
}

func (t *catalogTally) addSkills(skills []armorySkill) {
	for _, s := range skills {
		if s.Name == "" {
			continue
		}
		st := t.skills[s.Name]
		if st == nil {
			st = &catalogSkillTally{skill: catalogSkill{Name: s.Name, Category: s.Category, Icon: s.Icon, NeedLevel: s.NeedLevel}}
			t.skills[s.Name] = st
			t.skillOrder = append(t.skillOrder, s.Name)
		}
		st.skill.MaxLevel = max(st.skill.MaxLevel, s.Level)
		if s.Equipped {
			st.skill.Bar++
		}
		if st.skill.Icon == "" {
			st.skill.Icon = s.Icon
		}
		if st.skill.NeedLevel == 0 {
			st.skill.NeedLevel = s.NeedLevel
		}
	}
}

func (t *catalogTally) slot(name string) *catalogSlotTally {
	s := t.slots[name]
	if s == nil {
		s = &catalogSlotTally{items: map[string]*catalogItemTally{}, stones: map[string]*catalogStone{}, gods: map[string]*catalogStone{},
			rolled: map[string]*catalogRolledValues{}, boosts: map[string]*catalogBoostValues{}}
		t.slots[name] = s
	}
	return s
}

func (t *catalogTally) addGear(gear []armoryGear) {
	for _, g := range gear {
		if g.Name == "" || !buildSlots[g.Slot] {
			continue
		}
		t.slot(catalogSlotOf(g.Slot)).add(g)
	}
}

func (s *catalogSlotTally) add(g armoryGear) {
	key := g.Name + "|" + g.Grade
	it := s.items[key]
	if it == nil {
		it = &catalogItemTally{item: catalogItem{Name: g.Name, Grade: g.Grade, Icon: g.Icon, Sources: []string{}, Classes: []string{}, Main: []catalogStat{}, Exceed: []catalogStat{}},
			main: map[string]*catalogStatValues{}, exceed: map[string]*catalogStatValues{}}
		s.items[key] = it
		s.itemOrder = append(s.itemOrder, key)
	}
	it.item.Count++
	it.enchants = append(it.enchants, g.Enchant)
	it.item.MaxEnchant = max(it.item.MaxEnchant, g.Enchant)
	it.item.MaxExceed = max(it.item.MaxExceed, g.Exceed)
	it.item.MaxLevel = max(it.item.MaxLevel, g.Level)
	if it.item.Icon == "" {
		it.item.Icon = g.Icon
	}
	d := g.Detail
	if d == nil {
		return
	}
	it.detailedSeen++
	if d.ItemLevel > 0 {
		it.levels = append(it.levels, d.ItemLevel)
	}
	it.item.MaxEnchant, it.item.MaxExceed = max(it.item.MaxEnchant, d.MaxEnchant), max(it.item.MaxExceed, d.MaxExceed)
	it.item.Category, it.item.Kind = cmp.Or(it.item.Category, d.Category), cmp.Or(it.item.Kind, d.Kind)
	it.item.EquipLevel = max(it.item.EquipLevel, d.EquipLevel)
	it.item.Race = cmp.Or(it.item.Race, d.Race)
	if len(it.item.Classes) == 0 && len(d.Classes) > 0 {
		it.item.Classes = d.Classes
	}
	it.item.Tradable = it.item.Tradable || d.Tradable
	it.stoneSlots, it.godSlots = append(it.stoneSlots, d.StoneSlots), append(it.godSlots, d.GodSlots)
	if d.SubCount > 0 {
		it.subCounts = append(it.subCounts, d.SubCount)
	}
	for _, source := range d.Sources {
		it.sources.add(source)
	}
	// The set: its pieces (as a full profile lists them) and bonuses, none worn.
	if d.Set != nil {
		if it.item.Set == nil {
			it.item.Set = &armorySet{Name: d.Set.Name, Items: []armorySetItem{}, Bonuses: []armorySetBonus{}}
		}
		if !it.setItemsKnown && len(d.Set.Items) > 0 {
			items := make([]armorySetItem, len(d.Set.Items))
			for i, piece := range d.Set.Items {
				items[i] = armorySetItem{Name: piece.Name, Grade: piece.Grade}
			}
			it.item.Set.Items, it.setItemsKnown = items, true
		}
		if len(it.item.Set.Bonuses) == 0 && len(d.Set.Bonuses) > 0 {
			it.item.Set.Bonuses = d.Set.Bonuses
		}
	}
	it.addLines(d.Main, g.Enchant, g.Exceed)
	for _, stone := range d.Stones {
		s.addStone(s.stones, &s.stoneOrder, stone, stone.Value != "")
	}
	for _, stone := range d.GodStones {
		s.addStone(s.gods, &s.godOrder, stone, true)
	}
	s.addRolled(d.Sub)
	for _, raised := range d.SubSkills {
		if raised.Name == "" {
			continue
		}
		b := s.boosts[raised.Name]
		if b == nil {
			b = &catalogBoostValues{boost: catalogBoost{Name: raised.Name, Icon: raised.Icon}}
			s.boosts[raised.Name] = b
			s.boostOrder = append(s.boostOrder, raised.Name)
		}
		b.boost.Count++
		b.levels = append(b.levels, raised.Level)
		if b.boost.Icon == "" {
			b.boost.Icon = raised.Icon
		}
	}
}

// addStone counts a stone by name, value and grade; only those whose value is known (full
// profiles: a build of armory_ranks keeps stones by name and grade alone) and theostones.
func (s *catalogSlotTally) addStone(kept map[string]*catalogStone, order *[]string, stone armoryStone, known bool) {
	if stone.Name == "" || !known {
		return
	}
	key := stone.Name + "|" + stone.Value + "|" + stone.Grade
	c := kept[key]
	if c == nil {
		c = &catalogStone{Name: stone.Name, Value: stone.Value, Grade: stone.Grade, Desc: stone.Desc, Icon: stone.Icon}
		kept[key] = c
		*order = append(*order, key)
	}
	c.Count++
	if c.Icon == "" {
		c.Icon = stone.Icon
	}
}

func (s *catalogSlotTally) addRolled(lines []armoryLine) {
	for _, line := range lines {
		value, percent, ok := rolledValue(line.Value)
		if !ok || line.Name == "" {
			continue
		}
		key := line.Name + "|" + strconv.FormatBool(percent)
		r := s.rolled[key]
		if r == nil {
			r = &catalogRolledValues{stat: catalogRolled{Name: line.Name, Percent: percent}}
			s.rolled[key] = r
			s.rollOrder = append(s.rollOrder, key)
		}
		r.stat.Count++
		r.values = append(r.values, value)
	}
}

// addLines counts an item's main stats line by line (a name twice in one item, a weapon's two
// attacks, say, as two lines): their values at no enchantment and what one enchantment level adds
// (the extra over the enchantment); an exceed line what one exceed level adds.
func (it *catalogItemTally) addLines(lines []armoryLine, enchant, exceed int64) {
	seen := map[string]int{}
	for _, line := range lines {
		if line.Name == "" {
			continue
		}
		value, percent, ok := rolledValue(line.Value)
		extra, extraPercent, extraOk := rolledValue(line.Extra)
		if line.Exceed {
			percent = extraPercent || percent
		}
		key := line.Name + "|" + strconv.FormatBool(percent)
		seen[key]++
		key += "|" + strconv.Itoa(seen[key])
		if line.Exceed {
			if !extraOk && ok {
				extra, extraOk = value, true
			}
			if !extraOk || exceed <= 0 {
				continue
			}
			sv := it.stat(it.exceed, &it.exceedOrder, key, line.Name, percent)
			sv.per = append(sv.per, extra/float64(exceed))
			continue
		}
		if !ok {
			continue
		}
		sv := it.stat(it.main, &it.mainOrder, key, line.Name, percent)
		sv.values = append(sv.values, value)
		if low, _, lowOk := rolledValue(line.Min); lowOk {
			sv.mins = append(sv.mins, low)
		}
		if extraOk && enchant > 0 {
			sv.per = append(sv.per, extra/float64(enchant))
		}
	}
}

func (it *catalogItemTally) stat(kept map[string]*catalogStatValues, order *[]string, key, name string, percent bool) *catalogStatValues {
	sv := kept[key]
	if sv == nil {
		sv = &catalogStatValues{stat: catalogStat{Name: name, Percent: percent}}
		kept[key] = sv
		*order = append(*order, key)
	}
	return sv
}

// catalogRound rounds to three decimals, as the values PLAYNC writes have at most two.
func catalogRound(v float64) float64 { return math.Round(v*1000) / 1000 }

func (it *catalogItemTally) result() catalogItem {
	out := it.item
	out.ItemLevel, out.Enchant = median(it.levels), median(it.enchants)
	out.StoneSlots, out.GodSlots, out.SubCount = median(it.stoneSlots), median(it.godSlots), median(it.subCounts)
	out.Sources = names(it.sources.top(4))
	// A line only some copies list is left out below half of the copies whose details are known.
	most := 0
	for _, key := range it.mainOrder {
		most = max(most, len(it.main[key].values))
	}
	for _, key := range it.mainOrder {
		sv := it.main[key]
		if len(sv.values)*2 < most {
			continue
		}
		stat := sv.stat
		stat.Value, stat.Min, stat.PerEnchant = catalogRound(median(sv.values)), catalogRound(median(sv.mins)), catalogRound(median(sv.per))
		out.Main = append(out.Main, stat)
	}
	for _, key := range it.exceedOrder {
		sv := it.exceed[key]
		stat := sv.stat
		stat.PerLevel = catalogRound(median(sv.per))
		out.Exceed = append(out.Exceed, stat)
	}
	return out
}

func (s *catalogSlotTally) result(slot string) catalogSlot {
	out := catalogSlot{Slot: slot, Items: []catalogItem{}, Stones: []catalogStone{}, Gods: []catalogStone{}, Rolled: []catalogRolled{}, Boosts: []catalogBoost{}}
	for _, key := range s.itemOrder {
		out.Items = append(out.Items, s.items[key].result())
	}
	// The highest item level first, the higher grade of one item level, then the item worn most.
	slices.SortStableFunc(out.Items, func(a, b catalogItem) int {
		return cmp.Or(cmp.Compare(b.ItemLevel, a.ItemLevel), cmp.Compare(gradeRanks[b.Grade], gradeRanks[a.Grade]), b.Count-a.Count)
	})
	out.Items = out.Items[:min(catalogItems, len(out.Items))]
	stones := func(kept map[string]*catalogStone, order []string) []catalogStone {
		list := make([]catalogStone, 0, len(order))
		for _, key := range order {
			list = append(list, *kept[key])
		}
		slices.SortStableFunc(list, func(a, b catalogStone) int { return b.Count - a.Count })
		return list[:min(catalogStones, len(list))]
	}
	out.Stones, out.Gods = stones(s.stones, s.stoneOrder), stones(s.gods, s.godOrder)
	for _, key := range s.rollOrder {
		r := s.rolled[key]
		stat := r.stat
		stat.Low, stat.Value, stat.High = slices.Min(r.values), median(r.values), slices.Max(r.values)
		out.Rolled = append(out.Rolled, stat)
	}
	slices.SortStableFunc(out.Rolled, func(a, b catalogRolled) int { return b.Count - a.Count })
	out.Rolled = out.Rolled[:min(catalogStones, len(out.Rolled))]
	for _, key := range s.boostOrder {
		b := s.boosts[key]
		boost := b.boost
		boost.Level, boost.High = median(b.levels), slices.Max(b.levels)
		out.Boosts = append(out.Boosts, boost)
	}
	slices.SortStableFunc(out.Boosts, func(a, b catalogBoost) int { return b.Count - a.Count })
	out.Boosts = out.Boosts[:min(catalogStones, len(out.Boosts))]
	return out
}

func (t *catalogTally) catalog(class string, at time.Time) buildCatalog {
	out := buildCatalog{Class: class, Characters: t.characters, Boards: []catalogBoard{}, Skills: []catalogSkill{}, Slots: []catalogSlot{}, BuiltAt: at.UTC().Format(isoLayout)}
	for _, id := range t.boardOrder {
		bt := t.boards[id]
		board := bt.board
		board.Nodes = make([]armoryNode, 0, len(bt.nodes))
		for _, n := range bt.nodes {
			board.Nodes = append(board.Nodes, n)
		}
		slices.SortFunc(board.Nodes, func(a, b armoryNode) int { return cmp.Or(cmp.Compare(a.Row, b.Row), cmp.Compare(a.Col, b.Col)) })
		out.Boards = append(out.Boards, board)
	}
	for _, name := range t.skillOrder {
		out.Skills = append(out.Skills, t.skills[name].skill)
	}
	for _, slot := range catalogOrder {
		if s := t.slots[slot]; s != nil {
			out.Slots = append(out.Slots, s.result(slot))
		}
	}
	return out
}

// ---------------------------------------------------------------- reading

// workOutCatalog reads a class's catalog from the profiles readers opened (newest first) and the
// builds of armory_ranks of characters without such a profile; hidden characters left out.
func workOutCatalog(app core.App, class string) (buildCatalog, error) {
	t, read := newCatalogTally(), map[string]bool{}
	params := dbx.Params{"class": class, "profiles": catalogProfiles, "builds": catalogBuilds}
	rows, err := app.DB().NewQuery("SELECT p.serverId, p.characterId, COALESCE(json_extract(p.profile, '$.gear'), '[]'), COALESCE(json_extract(p.profile, '$.skills'), '[]'), COALESCE(json_extract(p.profile, '$.boards'), '[]') " +
		"FROM armory_profiles p JOIN armory_ranks r ON r.serverId = p.serverId AND r.characterId = p.characterId " +
		"WHERE r.class = {:class} AND r.hidden = FALSE AND p.hidden = FALSE AND p.fetchedAt != '' ORDER BY p.fetchedAt DESC LIMIT {:profiles}").Bind(params).Rows()
	if err != nil {
		return buildCatalog{}, err
	}
	for rows.Next() {
		var serverId int
		var characterId, gear, skills, boards string
		if err := rows.Scan(&serverId, &characterId, &gear, &skills, &boards); err != nil {
			rows.Close()
			return buildCatalog{}, err
		}
		var p armoryProfile
		if json.Unmarshal([]byte(gear), &p.Gear) != nil || json.Unmarshal([]byte(skills), &p.Skills) != nil || json.Unmarshal([]byte(boards), &p.Boards) != nil {
			continue
		}
		read[armoryKey(serverId, characterId)] = true
		t.characters++
		t.addBoards(p.Boards)
		t.addSkills(p.Skills)
		t.addGear(p.Gear)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return buildCatalog{}, err
	}
	rows, err = app.DB().NewQuery("SELECT serverId, characterId, COALESCE(CAST(build AS TEXT), '') FROM armory_ranks WHERE class = {:class} AND hidden = FALSE AND builtAt != '' ORDER BY builtAt DESC LIMIT {:builds}").Bind(params).Rows()
	if err != nil {
		return buildCatalog{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var serverId int
		var characterId, build string
		if err := rows.Scan(&serverId, &characterId, &build); err != nil {
			return buildCatalog{}, err
		}
		var p armoryProfile
		if read[armoryKey(serverId, characterId)] || json.Unmarshal([]byte(build), &p) != nil || len(p.Gear) == 0 {
			continue
		}
		t.characters++
		t.addGear(p.Gear)
		// A build keeps only the skills on the skill bar: they count as kept there.
		t.addSkills(p.Skills)
	}
	if err := rows.Err(); err != nil {
		return buildCatalog{}, err
	}
	catalog := t.catalog(class, time.Now())
	catalog.Icon = classIcons(app)[class]
	return catalog, nil
}

// buildCatalogCache keeps each class's catalog for catalogKeep (one without any character for
// catalogEmptyKeep), worked out once however many ask for it meanwhile.
type buildCatalogCache struct {
	mu   sync.Mutex
	kept map[string]*buildCatalogEntry
}

type buildCatalogEntry struct {
	once    sync.Once
	catalog buildCatalog
	err     error
	at      time.Time
}

func newBuildCatalogCache() *buildCatalogCache {
	return &buildCatalogCache{kept: map[string]*buildCatalogEntry{}}
}

// fresh says whether a kept catalog may still be given.
func (c *buildCatalogEntry) fresh() bool {
	keep := catalogKeep
	if c.catalog.Characters == 0 {
		keep = catalogEmptyKeep
	}
	return c.err == nil && time.Since(c.at) < keep
}

func (c *buildCatalogCache) of(app core.App, class string) (buildCatalog, error) {
	c.mu.Lock()
	entry := c.kept[class]
	if entry == nil || !entry.at.IsZero() && !entry.fresh() {
		if entry == nil && len(c.kept) >= catalogCached {
			// Make room: the catalog worked out longest ago goes.
			oldest := ""
			for key, e := range c.kept {
				if !e.at.IsZero() && (oldest == "" || e.at.Before(c.kept[oldest].at)) {
					oldest = key
				}
			}
			delete(c.kept, oldest)
		}
		entry = &buildCatalogEntry{}
		c.kept[class] = entry
	}
	c.mu.Unlock()
	entry.once.Do(func() {
		catalog, err := buildCatalog{}, unavailable("Many lookups at the moment. Try again in a minute.") // what those waiting hear should it panic
		defer func() {
			c.mu.Lock()
			entry.catalog, entry.err, entry.at = catalog, err, time.Now()
			c.mu.Unlock()
		}()
		catalog, err = workOutCatalog(app, class)
	})
	c.mu.Lock()
	defer c.mu.Unlock()
	return entry.catalog, entry.err
}

// catalogRoute answers GET /api/odyle/armory/catalog/{class}: what a build of the class can hold,
// from what the armory keeps of the class (buildCatalog). Public; rate limited per address with
// the armory.
func catalogRoute(e *core.RequestEvent) error {
	class := e.Request.PathValue("class")
	if !upgradeClass.MatchString(class) || strings.TrimSpace(class) != class {
		return notFound("The armory keeps no character of that class.")
	}
	catalog, err := stateOf(e.App).catalogs.of(e.App, class)
	if err != nil {
		return err
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=600")
	return e.JSON(200, catalog)
}
