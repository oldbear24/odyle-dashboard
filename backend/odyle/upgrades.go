package odyle

import (
	"cmp"
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory's Upgrade tab (src/upgrade.js): what the strongest characters of a class wear,
// slot by slot, so a player sees where their own gear falls furthest behind and what the
// strongest wear there instead, how far they enchant it and where it comes from. PLAYNC's
// Global pages list no rankings (docs/armory.md), so the strongest are those of the profiles
// the armory keeps, from every Global region: the characters anyone looked up in the last 30
// days, by combat power. Nothing more is asked of PLAYNC for it, and no player types anything
// in (R1).
//
// Each saved profile names its class and combat power in indexed fields of armory_profiles
// (watchArmoryProfiles), so a class's strongest are one query. They are read at most every
// upgradeKeep and kept for everyone, without what the comparison does not need; each request
// compares the profile it is for with the strongest other characters.

const (
	upgradeSample  = 20               // the strongest characters of a class compared with
	upgradeKeep    = 10 * time.Minute // a class's comparison is worked out again after
	upgradePopular = 3                // items listed for a slot, most worn first
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
	Class       string          `json:"class"`
	Players     []upgradePlayer `json:"players"`
	CombatPower upgradeSpread   `json:"combatPower"`
	ItemLevel   upgradeSpread   `json:"itemLevel"`
	Slots       []upgradeGear   `json:"slots"`
	Sets        []upgradeSet    `json:"sets"`
	Boards      []upgradeBoard  `json:"boards"`
	Skills      []upgradeSkill  `json:"skills"`
	BuiltAt     string          `json:"builtAt"`
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
// medians of its item level, enchantment, exceed level and stones, the items worn most and the
// stones engraved most.
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
func median(values []int64) int64 {
	if len(values) == 0 {
		return 0
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

// The tallies of one slot, and of one item worn in it.
type slotTally struct {
	players                                        map[int]bool
	items                                          int
	grades, stones                                 counted
	levels, enchants, exceeds, engraved, stoneRoom []int64
	worn                                           map[string]*itemTally
	order                                          []string
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
	return out
}

// compareUpgrades works out the comparison from the profiles of the strongest characters of a
// class, strongest first, as read at.
func compareUpgrades(class string, players []upgradePlayer, profiles []armoryProfile, at time.Time) upgradeReference {
	ref := upgradeReference{Class: class, Players: players, Slots: []upgradeGear{}, Sets: []upgradeSet{}, Boards: []upgradeBoard{}, Skills: []upgradeSkill{}, BuiltAt: isoTime(at)}
	powers, levels := []int64{}, []int64{}
	for _, p := range players {
		powers, levels = append(powers, p.CombatPower), append(levels, p.ItemLevel)
	}
	ref.CombatPower, ref.ItemLevel = spread(powers), spread(levels)
	slots, extra := map[string]*slotTally{}, []string{}
	type setTally struct {
		players int
		pieces  []int64
	}
	sets, setOrder := map[string]*setTally{}, []string{}
	type boardTally struct {
		open  []int64
		total int64
	}
	boards, boardOrder := map[string]*boardTally{}, []string{}
	type skillTally struct {
		skill  upgradeSkill
		levels []int64
	}
	skills, skillOrder := map[string]*skillTally{}, []string{}
	for i, p := range profiles {
		worn := map[string]int64{} // the sets this character wears pieces of
		for _, g := range p.Gear {
			slot := upgradeSlot(g.Slot)
			if slot == "" || g.Name == "" {
				continue
			}
			if slots[slot] == nil {
				slots[slot] = &slotTally{players: map[int]bool{}, worn: map[string]*itemTally{}}
				if !slices.Contains(upgradeSlots, slot) {
					extra = append(extra, slot)
				}
			}
			slots[slot].add(i, g)
			if g.Detail != nil && g.Detail.Set != nil && g.Detail.Set.Name != "" {
				worn[g.Detail.Set.Name] = max(worn[g.Detail.Set.Name], g.Detail.Set.Equipped)
			}
		}
		for _, g := range p.Gear {
			if g.Detail == nil || g.Detail.Set == nil {
				continue
			}
			name := g.Detail.Set.Name
			if pieces, ok := worn[name]; ok {
				if sets[name] == nil {
					sets[name] = &setTally{}
					setOrder = append(setOrder, name)
				}
				sets[name].players++
				sets[name].pieces = append(sets[name].pieces, pieces)
				delete(worn, name)
			}
		}
		for _, b := range p.Boards {
			if b.Name == "" {
				continue
			}
			if boards[b.Name] == nil {
				boards[b.Name] = &boardTally{}
				boardOrder = append(boardOrder, b.Name)
			}
			boards[b.Name].open = append(boards[b.Name].open, b.Open)
			boards[b.Name].total = max(boards[b.Name].total, b.Total)
		}
		for _, s := range p.Skills {
			if !s.Equipped || s.Name == "" {
				continue
			}
			if skills[s.Name] == nil {
				skills[s.Name] = &skillTally{skill: upgradeSkill{Name: s.Name, Category: s.Category, Icon: s.Icon}}
				skillOrder = append(skillOrder, s.Name)
			}
			skills[s.Name].skill.Players++
			skills[s.Name].levels = append(skills[s.Name].levels, s.Level)
		}
	}
	for _, slot := range append(slices.Clone(upgradeSlots), extra...) {
		if s := slots[slot]; s != nil {
			ref.Slots = append(ref.Slots, s.gear(slot))
		}
	}
	for _, name := range setOrder {
		ref.Sets = append(ref.Sets, upgradeSet{Name: name, Players: sets[name].players, Pieces: median(sets[name].pieces)})
	}
	slices.SortStableFunc(ref.Sets, func(a, b upgradeSet) int { return cmp.Or(b.Players-a.Players, cmp.Compare(b.Pieces, a.Pieces)) })
	ref.Sets = ref.Sets[:min(8, len(ref.Sets))]
	for _, name := range boardOrder {
		ref.Boards = append(ref.Boards, upgradeBoard{Name: name, Players: len(boards[name].open), Open: median(boards[name].open), Total: boards[name].total})
	}
	for _, name := range skillOrder {
		s := skills[name].skill
		s.Level = median(skills[name].levels)
		ref.Skills = append(ref.Skills, s)
	}
	slices.SortStableFunc(ref.Skills, func(a, b upgradeSkill) int { return cmp.Or(b.Players-a.Players, cmp.Compare(b.Level, a.Level)) })
	ref.Skills = ref.Skills[:min(24, len(ref.Skills))]
	return ref
}

// slim leaves out of a profile what the comparison does not read: stats, skins, titles, the
// boards' nodes and most of the items' details.
func (p *armoryProfile) slim() {
	p.Stats, p.Skins, p.Titles = nil, nil, armoryTitles{}
	for i := range p.Boards {
		p.Boards[i].Nodes, p.Boards[i].StatEffects, p.Boards[i].SkillEffects = nil, nil, nil
	}
	for i := range p.Gear {
		if d := p.Gear[i].Detail; d != nil {
			d.Main, d.Sub, d.SubSkills, d.GodStones, d.Skins, d.Classes, d.Desc = nil, nil, nil, nil, nil, nil, ""
			if d.Set != nil {
				d.Set = &armorySet{Name: d.Set.Name, Equipped: d.Set.Equipped}
			}
		}
	}
}

// strongestOf reads the strongest kept profiles of a class, hidden ones and those kept in an
// older shape left out: one more than the comparison takes, so it still has as many when the
// profile it is for is one of them.
func strongestOf(app core.App, class string) ([]upgradePlayer, []armoryProfile, error) {
	rows := []struct {
		Region      string `db:"region"`
		ServerId    int    `db:"serverId"`
		CharacterId string `db:"characterId"`
		Profile     string `db:"profile"`
	}{}
	if err := app.DB().NewQuery("SELECT region, serverId, characterId, profile FROM armory_profiles WHERE class = {:class} AND hidden = FALSE AND combatPower > 0 ORDER BY combatPower DESC, id LIMIT {:limit}").
		Bind(dbx.Params{"class": class, "limit": 2 * upgradeSample}).All(&rows); err != nil {
		return nil, nil, err
	}
	players, profiles := []upgradePlayer{}, []armoryProfile{}
	for _, row := range rows {
		var p armoryProfile
		if len(profiles) > upgradeSample || json.Unmarshal([]byte(row.Profile), &p) != nil || p.Version < armoryVersion || p.Class != class || len(p.Gear) == 0 {
			continue
		}
		p.slim()
		profiles = append(profiles, p)
		players = append(players, upgradePlayer{Name: p.Name, Level: p.Level, Server: p.Server, Region: row.Region, ServerId: row.ServerId, CharacterId: row.CharacterId, CombatPower: p.CombatPower, ItemLevel: p.ItemLevel, Portrait: p.Portrait})
	}
	return players, profiles, nil
}

// upgradeCache keeps the strongest of each class for upgradeKeep.
type upgradeCache struct {
	mu   sync.Mutex
	kept map[string]upgradeKept
}

type upgradeKept struct {
	players  []upgradePlayer
	profiles []armoryProfile
	at       time.Time
}

func newUpgradeCache() *upgradeCache { return &upgradeCache{kept: map[string]upgradeKept{}} }

// of is the strongest of the class, read again once they are upgradeKeep old. Only classes the
// armory keeps characters of are kept, so asking for made-up ones keeps nothing.
func (c *upgradeCache) of(app core.App, class string) (upgradeKept, error) {
	c.mu.Lock()
	kept, ok := c.kept[class]
	c.mu.Unlock()
	if ok && time.Since(kept.at) < upgradeKeep {
		return kept, nil
	}
	players, profiles, err := strongestOf(app, class)
	kept = upgradeKept{players: players, profiles: profiles, at: time.Now()}
	if err != nil || len(players) == 0 {
		return kept, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.kept) >= 64 {
		c.kept = map[string]upgradeKept{}
	}
	c.kept[class] = kept
	return kept, nil
}

// compare is the comparison for a profile (serverId, characterId), with the strongest other
// characters of the class.
func (k upgradeKept) compare(class string, serverId int, characterId string) upgradeReference {
	players, profiles := []upgradePlayer{}, []armoryProfile{}
	for i, p := range k.players {
		if len(players) < upgradeSample && (p.ServerId != serverId || p.CharacterId != characterId) {
			players, profiles = append(players, p), append(profiles, k.profiles[i])
		}
	}
	return compareUpgrades(class, players, profiles, k.at)
}

// A class as PLAYNC names it (Chanter, Spiritmaster).
var upgradeClass = regexp.MustCompile(`^[A-Za-z][A-Za-z '-]{1,39}$`)

// upgradesRoute answers GET /api/odyle/armory/upgrades/{class}?serverId=&characterId=: what the
// strongest characters of the class the armory keeps wear, for the Upgrade tab of the profile the
// query names, which is left out of them; no characters while the armory keeps none of the class.
// Public; rate limited per address with the armory.
func upgradesRoute(e *core.RequestEvent) error {
	class, q := e.Request.PathValue("class"), e.Request.URL.Query()
	if !upgradeClass.MatchString(class) {
		return notFound("The armory keeps no character of that class.")
	}
	serverId, _ := strconv.Atoi(q.Get("serverId"))
	kept, err := stateOf(e.App).upgrades.of(e.App, class)
	if err != nil {
		return err
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=300")
	return e.JSON(200, kept.compare(class, serverId, q.Get("characterId")))
}

// watchArmoryProfiles keeps a saved profile's class and combat power in fields of their own,
// indexed, for the Upgrade tab to find the strongest of a class in one query.
func watchArmoryProfiles(app core.App) {
	named := func(e *core.RecordEvent) error {
		var p struct {
			Class       string `json:"class"`
			CombatPower int64  `json:"combatPower"`
		}
		if err := e.Record.UnmarshalJSONField("profile", &p); err != nil {
			p.Class, p.CombatPower = "", 0
		}
		e.Record.Set("class", cut(p.Class, 40))
		e.Record.Set("combatPower", max(0, p.CombatPower))
		return e.Next()
	}
	app.OnRecordCreate("armory_profiles").BindFunc(named)
	app.OnRecordUpdate("armory_profiles").BindFunc(named)
}
