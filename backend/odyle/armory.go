package odyle

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The armory (#67): anyone, signed in or not, looks up an AION 2 Global character and sees
// everything PLAYNC's official character pages list for it: gear with each item's details,
// combat power, item level, stats, skills, titles, skins and Daevanion boards
// (/api/character/info, /equipment, /equipment/item and /daevanion/detail on
// aion2.plaync.com, docs/armory.md), with the game's icons and the character's portrait kept
// on the Odyle server (armoryimages.go). Nothing in it is typed in or changed by players (R1)
// and no game packets are involved (R3).
//
// Profiles are kept in armory_profiles. A reader gets the kept copy at once, with its age;
// a profile not kept yet, older than armoryRefresh or kept in an older shape waits in one
// server-wide queue that asks PLAYNC for one profile at a time (its pages armoryStep apart),
// armoryPace apart, so a reader may wait and the page says for how long. The queue takes armoryQueueSize profiles, at most
// armoryPerAddress from one address; PLAYNC refusing the server (403, 429) stops it for a
// while. Superusers pause it under Server controls and keep a profile out for good with
// its hidden switch (Collections → armory_profiles); profiles nobody opened for 30 days
// are deleted.

const (
	armoryRefresh       = 6 * time.Hour       // a kept profile older than this is fetched again when opened
	armoryReaderRefresh = 15 * time.Minute    // a reader's Refresh counts once the profile is this old
	armoryKeep          = 30 * 24 * time.Hour // profiles nobody opened this long are deleted
	armoryQueueSize     = 100
	armoryPerAddress    = 3
	armoryMissing       = time.Hour        // a character PLAYNC does not list is not asked for again before
	armoryRetry         = 10 * time.Minute // a failed lookup is not tried again before
	armoryBlocked       = 10 * time.Minute // PLAYNC refused the server without saying how long
	armorySearchKeep    = 10 * time.Minute // a search's results are kept this long
)

// armoryPace is the time between two profile lookups, armoryStep between the pages of one
// lookup (info, equipment, then each item's and each open board's details) and
// armorySearchGap between two searches, server-wide; the test build shortens them.
var armoryPace, armoryStep, armorySearchGap = 5 * time.Second, 250 * time.Millisecond, time.Second

// armoryTook is how long a lookup is taken to last until the first one ends.
const armoryTook = 10 * time.Second

func armoryURL() string {
	if v := os.Getenv("PLAYNC_ARMORY_URL"); v != "" {
		return v
	}
	return "https://aion2.plaync.com"
}

// PLAYNC's character ids are URL-safe Base64 with padding.
var armoryIds = regexp.MustCompile(`^[A-Za-z0-9_-]{8,90}={0,2}$`)

// armoryServer is the name of a PLAYNC server id in a search region (searchRegions), or ""
// when the id does not belong to it: race * 1000 + region digit * 100 + list index + 1.
func armoryServer(region string, serverId int) string {
	for _, regions := range searchRegions {
		for _, r := range regions {
			if r.code != region || serverId/100%10 != r.digit {
				continue
			}
			at := serverId % 100
			names := map[int][]string{1: elyos, 2: asmodian}[serverId/1000]
			if at >= 1 && at <= len(names) && serverId < 3000 {
				return names[at-1]
			}
		}
	}
	return ""
}

// armoryVersion is the shape of the kept profiles: one kept in an older shape (without item
// details, skills, titles, skins, boards' nodes or images) is fetched again when opened.
const armoryVersion = 2

// The profile the armory keeps and shows, read from PLAYNC's answers: what the official
// pages list publicly, from the profile and stats to every equipped item with its details,
// the skins, skills, titles and Daevanion boards. Images are kept by file name (Portrait,
// Icon: armoryimages.go); rankings and the official pages' own texts are left out.
type armoryProfile struct {
	pcId         int64
	portraitLink string
	Version      int           `json:"v"`
	Name         string        `json:"name"`
	Level        int64         `json:"level"`
	Class        string        `json:"class"`
	Race         string        `json:"race"`
	Gender       string        `json:"gender"`
	Server       string        `json:"server"`
	Title        string        `json:"title"`
	TitleGrade   string        `json:"titleGrade"`
	CombatPower  int64         `json:"combatPower"`
	ItemLevel    int64         `json:"itemLevel"`
	Portrait     string        `json:"portrait"`
	Stats        []armoryStat  `json:"stats"`
	Gear         []armoryGear  `json:"gear"`
	Skins        []armorySkin  `json:"skins"`
	Skills       []armorySkill `json:"skills"`
	Titles       armoryTitles  `json:"titles"`
	Boards       []armoryBoard `json:"boards"`
}

// A stat: the six primary ones (STR, DEX, INT, CON, AGI, WIS) or a deity's ("Justice",
// deity "Nezekan"), with what it gives ("Attack increase +2.6%").
type armoryStat struct {
	Type    string   `json:"type"`
	Name    string   `json:"name"`
	Deity   string   `json:"deity,omitempty"`
	Value   int64    `json:"value"`
	Primary bool     `json:"primary"`
	Effects []string `json:"effects"`
}

// An equipped item by PLAYNC's slot name (MainHand, Earring1, Arcana3…, and Wings and Pet),
// with its details as the official item page lists them for this character.
type armoryGear struct {
	Slot    string      `json:"slot"`
	Name    string      `json:"name"`
	Grade   string      `json:"grade"`
	Enchant int64       `json:"enchant"`
	Exceed  int64       `json:"exceed"`
	Level   int64       `json:"level,omitempty"`
	Icon    string      `json:"icon,omitempty"`
	Detail  *armoryItem `json:"detail,omitempty"`
	id      int64
	order   int64
}

// armoryItem is an item's details: its type, level and limits, its stats (main, soul binding),
// the manastones and godstones engraved in it, the skills it raises and its set.
type armoryItem struct {
	Category   string           `json:"category"`
	Kind       string           `json:"kind"`
	ItemLevel  int64            `json:"itemLevel"`
	MaxEnchant int64            `json:"maxEnchant"`
	MaxExceed  int64            `json:"maxExceed"`
	EquipLevel int64            `json:"equipLevel"`
	Race       string           `json:"race"`
	Classes    []string         `json:"classes"`
	Main       []armoryLine     `json:"main"`
	Sub        []armoryLine     `json:"sub"`
	SubCount   int64            `json:"subCount"`
	SoulBind   string           `json:"soulBind"`
	SubSkills  []armorySubSkill `json:"subSkills"`
	StoneSlots int64            `json:"stoneSlots"`
	Stones     []armoryStone    `json:"stones"`
	GodSlots   int64            `json:"godSlots"`
	GodStones  []armoryStone    `json:"godStones"`
	Set        *armorySet       `json:"set,omitempty"`
	Desc       string           `json:"desc,omitempty"`
	Sources    []string         `json:"sources"`
	Skins      []string         `json:"skins"`
	Tradable   bool             `json:"tradable"`
	Storable   bool             `json:"storable"`
}

// A stat line of an item: "Attack 315 ~ 630 (+174)"; an exceed line has only its extra.
type armoryLine struct {
	Name   string `json:"name"`
	Min    string `json:"min,omitempty"`
	Value  string `json:"value"`
	Extra  string `json:"extra,omitempty"`
	Exceed bool   `json:"exceed,omitempty"`
}

type armorySubSkill struct {
	Name  string `json:"name"`
	Level int64  `json:"level"`
	Icon  string `json:"icon,omitempty"`
}

// A manastone ("Attack +10") or a godstone (with what it does).
type armoryStone struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
	Grade string `json:"grade"`
	Desc  string `json:"desc,omitempty"`
	Icon  string `json:"icon,omitempty"`
}

// An item's set: its pieces (those equipped marked) and the effects of 2, 3… pieces.
type armorySet struct {
	Name     string           `json:"name"`
	Equipped int64            `json:"equipped"`
	Items    []armorySetItem  `json:"items"`
	Bonuses  []armorySetBonus `json:"bonuses"`
}

type armorySetItem struct {
	Name     string `json:"name"`
	Grade    string `json:"grade"`
	Equipped bool   `json:"equipped"`
}

type armorySetBonus struct {
	Count   int64    `json:"count"`
	Effects []string `json:"effects"`
}

// A skin (an appearance over an equipped item or the wings).
type armorySkin struct {
	Slot  string `json:"slot"`
	Name  string `json:"name"`
	Grade string `json:"grade"`
	Icon  string `json:"icon,omitempty"`
	order int64
}

// A skill: Active, Passive or Dp (stigma), its level, whether the character learned it
// and has it on its bar.
type armorySkill struct {
	Name      string `json:"name"`
	Category  string `json:"category"`
	Level     int64  `json:"level"`
	NeedLevel int64  `json:"needLevel"`
	Acquired  bool   `json:"acquired"`
	Equipped  bool   `json:"equipped"`
	Icon      string `json:"icon,omitempty"`
}

// The titles the character owns, and the one it wears in each category (Attack, Defense, Etc).
type armoryTitles struct {
	Owned    int64         `json:"owned"`
	Total    int64         `json:"total"`
	Equipped []armoryTitle `json:"equipped"`
}

type armoryTitle struct {
	Category string   `json:"category"`
	Name     string   `json:"name"`
	Grade    string   `json:"grade"`
	Owned    int64    `json:"owned"`
	Total    int64    `json:"total"`
	Effects  []string `json:"effects"`
	Stats    []string `json:"stats"`
}

// A Daevanion board, how many of its nodes are open and, once any is, its nodes by row and
// column with what the open ones give.
type armoryBoard struct {
	Id           int64        `json:"id"`
	Name         string       `json:"name"`
	Open         int64        `json:"open"`
	Total        int64        `json:"total"`
	Icon         string       `json:"icon,omitempty"`
	Nodes        []armoryNode `json:"nodes"`
	StatEffects  []string     `json:"statEffects"`
	SkillEffects []string     `json:"skillEffects"`
}

// A board node: row, column, grade, type (Stat, SkillLevel, Start…), open, and its effect or
// (without one, or for other types) name, in short keys: a board has up to 150 nodes.
type armoryNode struct {
	Row    int64  `json:"r"`
	Col    int64  `json:"c"`
	Grade  string `json:"g"`
	Type   string `json:"t"`
	Open   bool   `json:"o,omitempty"`
	Name   string `json:"n,omitempty"`
	Effect string `json:"e,omitempty"`
}

var primaryStats = []string{"STR", "DEX", "INT", "CON", "AGI", "WIS"}

func jsonText(m map[string]any, key string, max int) string {
	s, _ := m[key].(string)
	return cut(collapse(tags.ReplaceAllString(s, "")), max)
}

// jsonValue is a value PLAYNC sends as text or as a number ("630", "13%", 630).
func jsonValue(m map[string]any, key string, max int) string {
	if f, ok := m[key].(float64); ok {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return jsonText(m, key, max)
}

func whole(v any) int64 { return int64(max(0, number(v))) }

func jsonObject(v any) map[string]any { m, _ := v.(map[string]any); return m }

func jsonList(v any) []map[string]any {
	list, _ := v.([]any)
	out := []map[string]any{}
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

// texts reads a list of texts, or of objects whose key holds the text, at most n, empty ones left out.
func texts(v any, key string, n, size int) []string {
	out := []string{}
	list, _ := v.([]any)
	for _, item := range list {
		var text string
		if s, ok := item.(string); ok {
			text = cut(collapse(tags.ReplaceAllString(s, "")), size)
		} else if m, ok := item.(map[string]any); ok {
			text = jsonText(m, key, size)
		}
		if text != "" && len(out) < n {
			out = append(out, text)
		}
	}
	return out
}

var deityName = regexp.MustCompile(`^(.*?)\s*\[(.*?)\]$`)

var errArmoryAnswer = errors.New("PLAYNC answered something else than a character profile.")

// readArmory turns PLAYNC's info and equipment answers into the kept profile, without the
// items' and boards' details (readItem, readBoard).
func readArmory(info, equipment map[string]any) (armoryProfile, error) {
	profile := jsonObject(info["profile"])
	p := armoryProfile{Version: armoryVersion, Name: jsonText(profile, "characterName", 40), Level: whole(profile["characterLevel"]), Class: jsonText(profile, "className", 40), Race: jsonText(profile, "raceName", 40),
		Gender: jsonText(profile, "genderName", 20), Server: jsonText(profile, "serverName", 40), Title: jsonText(profile, "titleName", 60), TitleGrade: jsonText(profile, "titleGrade", 20), CombatPower: whole(profile["combatPower"]),
		Stats: []armoryStat{}, Gear: []armoryGear{}, Skins: []armorySkin{}, Skills: []armorySkill{}, Titles: armoryTitles{Equipped: []armoryTitle{}}, Boards: []armoryBoard{},
		pcId: whole(profile["pcId"]), portraitLink: jsonText(profile, "profileImage", 300)}
	if p.Name == "" {
		return armoryProfile{}, errArmoryAnswer
	}
	for _, s := range jsonList(jsonObject(info["stat"])["statList"]) {
		kind := jsonText(s, "type", 20)
		if kind == "ItemLevel" {
			p.ItemLevel = whole(s["value"])
			continue
		}
		if kind == "" || len(p.Stats) >= 40 {
			continue
		}
		stat := armoryStat{Type: kind, Name: jsonText(s, "name", 40), Value: whole(s["value"]), Primary: slices.Contains(primaryStats, kind), Effects: texts(s["statSecondList"], "", 6, 80)}
		if m := deityName.FindStringSubmatch(stat.Name); m != nil {
			stat.Name, stat.Deity = m[1], m[2]
		}
		p.Stats = append(p.Stats, stat)
	}
	gear := jsonObject(equipment["equipment"])
	for _, g := range jsonList(gear["equipmentList"]) {
		if len(p.Gear) < 40 {
			p.Gear = append(p.Gear, armoryGear{Slot: jsonText(g, "slotPosName", 20), Name: jsonText(g, "name", 80), Grade: jsonText(g, "grade", 20), Enchant: whole(g["enchantLevel"]), Exceed: whole(g["exceedLevel"]), Icon: iconOf(g, "icon"), id: whole(g["id"]), order: whole(g["slotPos"])})
		}
	}
	slices.SortStableFunc(p.Gear, func(a, b armoryGear) int { return int(a.order - b.order) })
	companions := jsonObject(equipment["petwing"])
	wing := jsonObject(companions["wing"])
	if jsonText(wing, "name", 80) != "" {
		p.Gear = append(p.Gear, armoryGear{Slot: "Wings", Name: jsonText(wing, "name", 80), Grade: jsonText(wing, "grade", 20), Enchant: whole(wing["enchantLevel"]), Icon: iconOf(wing, "icon")})
	}
	if pet := jsonObject(companions["pet"]); jsonText(pet, "name", 80) != "" {
		p.Gear = append(p.Gear, armoryGear{Slot: "Pet", Name: jsonText(pet, "name", 80), Level: whole(pet["level"]), Icon: iconOf(pet, "icon")})
	}
	for _, s := range jsonList(gear["skinList"]) {
		if len(p.Skins) < 20 && jsonText(s, "name", 80) != "" {
			p.Skins = append(p.Skins, armorySkin{Slot: jsonText(s, "slotPosName", 20), Name: jsonText(s, "name", 80), Grade: jsonText(s, "grade", 20), Icon: iconOf(s, "icon"), order: whole(s["slotPos"])})
		}
	}
	slices.SortStableFunc(p.Skins, func(a, b armorySkin) int { return int(a.order - b.order) })
	// The wings' skin is listed even without one, as the wings themselves.
	if skin := jsonObject(companions["wingSkin"]); jsonText(skin, "name", 80) != "" && whole(skin["id"]) != whole(wing["id"]) {
		p.Skins = append(p.Skins, armorySkin{Slot: "Wings", Name: jsonText(skin, "name", 80), Grade: jsonText(skin, "grade", 20), Icon: iconOf(skin, "icon")})
	}
	for _, s := range jsonList(jsonObject(equipment["skill"])["skillList"]) {
		if len(p.Skills) < 80 && jsonText(s, "name", 60) != "" {
			p.Skills = append(p.Skills, armorySkill{Name: jsonText(s, "name", 60), Category: jsonText(s, "category", 20), Level: whole(s["skillLevel"]), NeedLevel: whole(s["needLevel"]),
				Acquired: whole(s["acquired"]) == 1, Equipped: whole(s["equip"]) == 1, Icon: iconOf(s, "icon")})
		}
	}
	titles := jsonObject(info["title"])
	p.Titles.Owned, p.Titles.Total = whole(titles["ownedCount"]), whole(titles["totalCount"])
	for _, t := range jsonList(titles["titleList"]) {
		if len(p.Titles.Equipped) < 6 && jsonText(t, "equipCategory", 20) != "" {
			p.Titles.Equipped = append(p.Titles.Equipped, armoryTitle{Category: jsonText(t, "equipCategory", 20), Name: jsonText(t, "name", 60), Grade: jsonText(t, "grade", 20),
				Owned: whole(t["ownedCount"]), Total: whole(t["totalCount"]), Effects: texts(t["equipStatList"], "desc", 8, 80), Stats: texts(t["statList"], "desc", 8, 80)})
		}
	}
	for _, b := range jsonList(jsonObject(info["daevanion"])["boardList"]) {
		if len(p.Boards) < 10 {
			p.Boards = append(p.Boards, armoryBoard{Id: whole(b["id"]), Name: jsonText(b, "name", 40), Open: whole(b["openNodeCount"]), Total: whole(b["totalNodeCount"]), Icon: iconOf(b, "icon"), Nodes: []armoryNode{}, StatEffects: []string{}, SkillEffects: []string{}})
		}
	}
	return p, nil
}

// readItem turns the official item page of an equipped item into its details.
func readItem(m map[string]any) *armoryItem {
	if jsonText(m, "name", 80) == "" {
		return nil
	}
	lines := func(v any, n int) []armoryLine {
		out := []armoryLine{}
		for _, s := range jsonList(v) {
			if len(out) < n && jsonText(s, "name", 60) != "" {
				line := armoryLine{Name: jsonText(s, "name", 60), Min: jsonValue(s, "minValue", 20), Value: jsonValue(s, "value", 20), Extra: jsonValue(s, "extra", 20), Exceed: s["exceed"] == true}
				if line.Extra == "0" || line.Extra == "0%" {
					line.Extra = ""
				}
				if line.Min == line.Value {
					line.Min = ""
				}
				out = append(out, line)
			}
		}
		return out
	}
	stones := func(v any, n int) []armoryStone {
		out := []armoryStone{}
		for _, s := range jsonList(v) {
			if len(out) < n && jsonText(s, "name", 60) != "" {
				out = append(out, armoryStone{Name: jsonText(s, "name", 60), Value: jsonValue(s, "value", 20), Grade: jsonText(s, "grade", 20), Desc: jsonText(s, "desc", 300), Icon: iconOf(s, "icon")})
			}
		}
		return out
	}
	item := &armoryItem{Category: jsonText(m, "categoryName", 40), Kind: jsonText(m, "type", 20), ItemLevel: whole(m["level"]), MaxEnchant: whole(m["maxEnchantLevel"]), MaxExceed: whole(m["maxExceedEnchantLevel"]),
		EquipLevel: whole(m["equipLevel"]), Race: jsonText(m, "raceName", 40), Classes: texts(m["classNames"], "", 10, 40), Main: lines(m["mainStats"], 12), Sub: lines(m["subStats"], 12),
		SubCount: whole(m["subStatCount"]), SoulBind: jsonValue(m, "soulBindRate", 10), SubSkills: []armorySubSkill{}, StoneSlots: whole(m["magicStoneSlotCount"]), Stones: stones(m["magicStoneStat"], 8),
		GodSlots: whole(m["godStoneSlotCount"]), GodStones: stones(m["godStoneStat"], 4), Desc: jsonText(m, "desc", 400), Sources: texts(m["sources"], "", 8, 60), Skins: texts(m["costumes"], "", 6, 80),
		Tradable: m["tradable"] == true, Storable: m["storable"] == true}
	for _, s := range jsonList(m["subSkills"]) {
		if len(item.SubSkills) < 8 && jsonText(s, "name", 60) != "" {
			item.SubSkills = append(item.SubSkills, armorySubSkill{Name: jsonText(s, "name", 60), Level: whole(s["level"]), Icon: iconOf(s, "icon")})
		}
	}
	if set := jsonObject(m["set"]); jsonText(set, "name", 60) != "" {
		item.Set = &armorySet{Name: jsonText(set, "name", 60), Equipped: whole(set["equippedCount"]), Items: []armorySetItem{}, Bonuses: []armorySetBonus{}}
		for _, i := range jsonList(set["items"]) {
			if len(item.Set.Items) < 10 && jsonText(i, "name", 80) != "" {
				item.Set.Items = append(item.Set.Items, armorySetItem{Name: jsonText(i, "name", 80), Grade: jsonText(i, "grade", 20), Equipped: i["equipped"] == true})
			}
		}
		for _, b := range jsonList(set["bonuses"]) {
			if len(item.Set.Bonuses) < 6 {
				item.Set.Bonuses = append(item.Set.Bonuses, armorySetBonus{Count: whole(b["degree"]), Effects: texts(b["descriptions"], "", 6, 160)})
			}
		}
	}
	return item
}

// readBoard adds a board's nodes and the effects of its open ones from its official page.
func readBoard(b *armoryBoard, m map[string]any) {
	for _, n := range jsonList(m["nodeList"]) {
		kind := jsonText(n, "type", 20)
		if kind == "" || kind == "None" || len(b.Nodes) >= 400 {
			continue
		}
		node := armoryNode{Row: whole(n["row"]), Col: whole(n["col"]), Grade: jsonText(n, "grade", 20), Type: kind, Open: whole(n["open"]) == 1, Name: jsonText(n, "name", 80),
			Effect: strings.Join(texts(n["effectList"], "desc", 4, 80), ", ")}
		// A stat or skill node's effect says what its name does ("Max MP": "MP +50").
		if node.Effect != "" && (kind == "Stat" || kind == "SkillLevel") {
			node.Name = ""
		}
		b.Nodes = append(b.Nodes, node)
	}
	slices.SortStableFunc(b.Nodes, func(x, y armoryNode) int { return int(x.Row*100 + x.Col - y.Row*100 - y.Col) })
	b.StatEffects, b.SkillEffects = texts(m["openStatEffectList"], "desc", 80, 80), texts(m["openSkillEffectList"], "desc", 80, 80)
}

var errArmoryMissing = errors.New("PLAYNC does not list this character.")

// armoryRefused is PLAYNC refusing the server (403 or 429), and how long it asked to wait.
type armoryRefused struct{ wait time.Duration }

func (r armoryRefused) Error() string { return "PLAYNC refused the lookup for now." }

// askPLAYNC fetches one of a character's official pages (info, equipment, equipment/item
// or daevanion/detail), with the page's own parameters as name and value pairs.
func askPLAYNC(page string, j armoryJob, params ...string) (map[string]any, error) {
	query := "region=" + j.region + "&lang=en-US&characterId=" + url.QueryEscape(j.characterId) + "&serverId=" + strconv.Itoa(j.serverId)
	for i := 0; i+1 < len(params); i += 2 {
		query += "&" + params[i] + "=" + url.QueryEscape(params[i+1])
	}
	res, err := send(call{method: "GET", url: armoryURL() + "/api/character/" + page + "?" + query, headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 15 * time.Second, limit: 1 << 20})
	if err != nil {
		return nil, err
	}
	switch {
	case res.status == 404:
		return nil, errArmoryMissing
	case res.status == 403 || res.status == 429:
		return nil, armoryRefused{wait: retryAfter(res)}
	case res.status != 200:
		return nil, fmt.Errorf("PLAYNC answered %d.", res.status)
	}
	found, ok := res.json().(map[string]any)
	if !ok {
		return nil, errArmoryAnswer
	}
	return found, nil
}

// detailArmory asks PLAYNC for the details of each equipped item and of each board with open
// nodes, armoryStep apart. A detail PLAYNC does not give leaves its item or board without
// one; PLAYNC refusing the server ends the lookup.
func detailArmory(p *armoryProfile, j armoryJob) error {
	var refused armoryRefused
	for i := range p.Gear {
		g := &p.Gear[i]
		if g.id <= 0 || g.order <= 0 {
			continue
		}
		time.Sleep(armoryStep)
		found, err := askPLAYNC("equipment/item", j, "id", strconv.FormatInt(g.id, 10), "enchantLevel", strconv.FormatInt(g.Enchant, 10), "slotPos", strconv.FormatInt(g.order, 10))
		if errors.As(err, &refused) {
			return err
		}
		if err == nil {
			g.Detail = readItem(found)
		}
	}
	for i := range p.Boards {
		b := &p.Boards[i]
		if b.Id <= 0 || b.Open == 0 {
			continue
		}
		time.Sleep(armoryStep)
		found, err := askPLAYNC("daevanion/detail", j, "boardId", strconv.FormatInt(b.Id, 10))
		if errors.As(err, &refused) {
			return err
		}
		if err == nil {
			readBoard(b, found)
		}
	}
	return nil
}

// armoryJob is a profile waiting for its lookup, and the address that asked for it.
type armoryJob struct {
	key, region, characterId, address string
	serverId                          int
}

func armoryKey(serverId int, characterId string) string {
	return strconv.Itoa(serverId) + "/" + characterId
}

// armoryMiss keeps a character that could not be looked up from being asked for again
// before until.
type armoryMiss struct {
	until   time.Time
	missing bool // PLAYNC does not list it
	error   string
}

// armoryState is where a profile's lookup stands, for the reader: queued (position profiles
// ahead, about wait seconds), fetching, failed (error), busy (the queue or the address has
// no room), paused, missing or fresh (nothing to do).
type armoryState struct {
	State      string
	Position   int
	Wait       int
	RetryAfter int
	Error      string
}

// armoryWork is the queue of profiles waiting for PLAYNC. One goroutine works it while it
// holds any; it ends when the queue is empty.
type armoryWork struct {
	mu        sync.Mutex
	idle      *sync.Cond    // signalled when the worker ends
	wake      chan struct{} // ends the worker's wait (dropped queue)
	waiting   []armoryJob
	current   string
	byAddress map[string]int
	misses    map[string]armoryMiss
	working   bool
	nextAt    time.Time     // the next lookup starts no earlier
	blocked   time.Time     // PLAYNC refused the server until then
	startedAt time.Time     // the running lookup started
	took      time.Duration // how long lookups last, on average
	lastAt    time.Time
	lastError string
	errorAt   time.Time
	done      int
	failed    int
}

func newArmoryWork() *armoryWork {
	w := &armoryWork{byAddress: map[string]int{}, misses: map[string]armoryMiss{}, wake: make(chan struct{}, 1), took: armoryTook}
	w.idle = sync.NewCond(&w.mu)
	return w
}

// later is the latest of the times.
func later(times ...time.Time) time.Time {
	out := times[0]
	for _, t := range times[1:] {
		if t.After(out) {
			out = t
		}
	}
	return out
}

// seconds is d in whole seconds, rounded up.
func seconds(d time.Duration) int { return int((max(0, d) + time.Second - 1) / time.Second) }

// queued is the state of the profile at index i of the queue. Its wait counts the lookup
// running now and the ones ahead, each lasting as long as lookups do and armoryPace apart,
// and its own lookup.
func (w *armoryWork) queued(i int, at time.Time) armoryState {
	start := later(w.nextAt, w.blocked, at)
	ahead := i
	if w.current != "" {
		ahead++
		start = later(start, w.startedAt.Add(w.took+armoryPace), at.Add(armoryPace))
	}
	wait := seconds(start.Sub(at) + time.Duration(i)*(w.took+armoryPace) + w.took + time.Second)
	return armoryState{State: "queued", Position: ahead, Wait: wait, RetryAfter: min(max(wait, 2), 15)}
}

// ask queues a profile for its lookup, unless it waits or runs already, or failed a moment
// ago, and says where it stands.
func (w *armoryWork) ask(app core.App, j armoryJob) armoryState {
	w.mu.Lock()
	defer w.mu.Unlock()
	at := time.Now()
	if miss, ok := w.misses[j.key]; ok {
		if at.Before(miss.until) {
			if miss.missing {
				return armoryState{State: "missing", Error: errArmoryMissing.Error()}
			}
			return armoryState{State: "failed", Error: miss.error, RetryAfter: seconds(miss.until.Sub(at))}
		}
		delete(w.misses, j.key)
	}
	if w.current == j.key {
		return armoryState{State: "fetching", RetryAfter: 2}
	}
	for i, q := range w.waiting {
		if q.key == j.key {
			return w.queued(i, at)
		}
	}
	if len(w.waiting) >= armoryQueueSize || w.byAddress[j.address] >= armoryPerAddress {
		return armoryState{State: "busy", RetryAfter: 30}
	}
	w.waiting = append(w.waiting, j)
	w.byAddress[j.address]++
	if !w.working {
		w.working = true
		go w.work(app)
	}
	return w.queued(len(w.waiting)-1, at)
}

// drop empties the queue (paused), and wakes a worker waiting for PLAYNC so it ends.
func (w *armoryWork) drop() {
	w.waiting, w.byAddress = nil, map[string]int{}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *armoryWork) work(app core.App) {
	for {
		paused := readSettings(app).ArmoryPaused
		w.mu.Lock()
		if paused {
			w.drop()
		}
		if len(w.waiting) == 0 {
			w.working = false
			w.mu.Unlock()
			w.idle.Broadcast()
			return
		}
		if wait := time.Until(later(w.nextAt, w.blocked)); wait > 0 {
			w.mu.Unlock()
			select {
			case <-time.After(wait):
			case <-w.wake:
			}
			continue
		}
		j := w.waiting[0]
		w.waiting = w.waiting[1:]
		if w.byAddress[j.address]--; w.byAddress[j.address] <= 0 {
			delete(w.byAddress, j.address)
		}
		w.current, w.startedAt = j.key, time.Now()
		w.mu.Unlock()
		err := lookUpArmory(app, j)
		w.mu.Lock()
		at := time.Now()
		w.current, w.lastAt, w.nextAt = "", at, at.Add(armoryPace)
		var refused armoryRefused
		switch {
		case err == nil:
			w.done++
			w.took = (3*w.took + at.Sub(w.startedAt)) / 4
		case errors.Is(err, errArmoryMissing):
			w.misses[j.key] = armoryMiss{until: at.Add(armoryMissing), missing: true}
		default:
			w.failed++
			w.lastError, w.errorAt = message(err), at
			w.misses[j.key] = armoryMiss{until: at.Add(armoryRetry), error: message(err)}
			if errors.As(err, &refused) {
				w.blocked = at.Add(max(refused.wait, armoryBlocked))
			}
			warn(app, "Odyle armory lookup failed", "character", j.key, "error", message(err))
		}
		// Old misses go once there are many.
		if len(w.misses) > 1000 {
			for key, miss := range w.misses {
				if at.After(miss.until) {
					delete(w.misses, key)
				}
			}
		}
		w.mu.Unlock()
	}
}

// wait returns once the queue is worked off (tests).
func (w *armoryWork) wait() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for w.working {
		w.idle.Wait()
	}
}

// lookUpArmory asks PLAYNC for a character's pages, with the details of its items and boards,
// keeps the images they name (armoryimages.go) and then the profile. A character PLAYNC no
// longer lists loses its kept profile (unless hidden); another failure keeps the profile and
// notes the error. Never call it inside a transaction: it waits on PLAYNC.
func lookUpArmory(app core.App, j armoryJob) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("the armory lookup failed: %v", r)
		}
	}()
	var profile armoryProfile
	info, err := askPLAYNC("info", j)
	if err == nil {
		var equipment map[string]any
		time.Sleep(armoryStep)
		if equipment, err = askPLAYNC("equipment", j); err == nil {
			if profile, err = readArmory(info, equipment); err == nil {
				err = detailArmory(&profile, j)
			}
		}
	}
	if err == nil {
		keepArmoryImages(app, &profile)
	}
	// The kept profile is read and written after PLAYNC answered, in one transaction: a view
	// (viewedAt) or the hidden switch set meanwhile is kept.
	if txErr := app.RunInTransaction(func(tx core.App) error {
		record, findErr := keptProfile(tx, j.serverId, j.characterId)
		if findErr != nil {
			return findErr
		}
		if errors.Is(err, errArmoryMissing) {
			if record != nil && !record.GetBool("hidden") {
				return tx.Delete(record)
			}
			return nil
		}
		if record == nil {
			if err != nil {
				return nil
			}
			collection, findErr := tx.FindCollectionByNameOrId("armory_profiles")
			if findErr != nil {
				return findErr
			}
			record = core.NewRecord(collection)
			record.Set("region", j.region)
			record.Set("serverId", j.serverId)
			record.Set("characterId", j.characterId)
			record.Set("viewedAt", now())
		}
		if err != nil {
			record.Set("error", cut(message(err), 300))
		} else {
			record.Set("name", profile.Name)
			record.Set("profile", profile)
			record.Set("fetchedAt", now())
			record.Set("error", "")
		}
		return tx.Save(record)
	}); txErr != nil {
		return txErr
	}
	// The page names the class of its class id, for every character with that id (classes.go).
	if err == nil {
		if learnErr := learnClass(app, profile.pcId, profile.Class); learnErr != nil {
			warn(app, "Odyle could not keep a class name", "error", message(learnErr))
		}
	}
	return err
}

func keptProfile(app core.App, serverId int, characterId string) (*core.Record, error) {
	record, err := app.FindFirstRecordByFilter("armory_profiles", "serverId = {:server} && characterId = {:id}", dbx.Params{"server": serverId, "id": characterId})
	if isNoRows(err) {
		return nil, nil
	}
	return record, err
}

// isoTime is t as an ISO time, or "" when it is zero.
func isoTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(isoLayout)
}

// armoryRoute answers GET /api/odyle/armory/{region}/{serverId}/{characterId}: the kept
// profile (or null) with its age and where its lookup stands. A profile kept in an older
// shape is asked for again, and ?refresh=1 asks PLAYNC again once the profile is
// armoryReaderRefresh old. Public; rate limited per address.
func armoryRoute(e *core.RequestEvent) error {
	region, characterId := e.Request.PathValue("region"), e.Request.PathValue("characterId")
	serverId, _ := strconv.Atoi(e.Request.PathValue("serverId"))
	server := armoryServer(region, serverId)
	if server == "" || !armoryIds.MatchString(characterId) {
		return notFound("This character is not in the armory.")
	}
	record, err := keptProfile(e.App, serverId, characterId)
	if err != nil {
		return err
	}
	if record != nil && record.GetBool("hidden") {
		return notFound("This character is not in the armory.")
	}
	out := newObject().set("region", region).set("serverId", serverId).set("characterId", characterId).set("server", server).set("profile", nil).set("fetchedAt", "").set("error", "")
	var fetched time.Time
	outdated := false
	if record != nil {
		fetched = record.GetDateTime("fetchedAt").Time()
		profile := parseJSON(record.GetString("profile"), "null")
		if kept, ok := profile.(map[string]any); ok {
			outdated = number(kept["v"]) < armoryVersion
		}
		out.set("profile", profile).set("fetchedAt", isoTime(fetched)).set("error", record.GetString("error"))
		// Opened: kept for another 30 days (written at most daily).
		if record.GetDateTime("viewedAt").Time().Before(time.Now().Add(-24 * time.Hour)) {
			if _, err := e.App.DB().NewQuery("UPDATE armory_profiles SET viewedAt = {:now} WHERE id = {:id}").Bind(dbx.Params{"now": stamp(time.Now()), "id": record.Id}).Execute(); err != nil {
				return err
			}
		}
	}
	age := time.Since(fetched)
	state := armoryState{State: "fresh"}
	if record == nil || age > armoryRefresh || outdated || e.Request.URL.Query().Get("refresh") == "1" && age > armoryReaderRefresh {
		if readSettings(e.App).ArmoryPaused {
			state = armoryState{State: "paused"}
		} else {
			state = stateOf(e.App).armory.ask(e.App, armoryJob{key: armoryKey(serverId, characterId), region: region, serverId: serverId, characterId: characterId, address: e.RealIP()})
		}
	}
	if state.State == "missing" {
		return notFound("PLAYNC does not list this character.")
	}
	return e.JSON(200, out.set("state", state.State).set("position", state.Position).set("wait", state.Wait).set("retryAfter", state.RetryAfter).set("lookupError", state.Error))
}

// armoryHit is a character the official search lists.
type armoryHit struct {
	Name        string `json:"name"`
	Level       int64  `json:"level"`
	Race        int64  `json:"race"`
	Server      string `json:"server"`
	ServerId    int    `json:"serverId"`
	Region      string `json:"region"`
	CharacterId string `json:"characterId"`
}

type searchAnswer struct {
	hits []armoryHit
	at   time.Time
}

// armorySearches keeps the searches of the last ten minutes and spaces those sent to
// PLAYNC armorySearchGap apart, server-wide.
type armorySearches struct {
	mu   sync.Mutex
	kept map[string]searchAnswer
	next time.Time
}

func newArmorySearches() *armorySearches { return &armorySearches{kept: map[string]searchAnswer{}} }

var errArmoryBusy = errors.New("Many lookups at the moment. Try again in a minute.")

// slot reserves the next moment a search may go to PLAYNC, waiting up to three seconds.
func (s *armorySearches) slot() error {
	s.mu.Lock()
	at := later(s.next, time.Now())
	if time.Until(at) > 3*time.Second {
		s.mu.Unlock()
		return errArmoryBusy
	}
	s.next = at.Add(armorySearchGap)
	s.mu.Unlock()
	time.Sleep(time.Until(at))
	return nil
}

// find lists the characters the official search finds by a name on a server (searches),
// those named exactly so first, at most 20.
func (s *armorySearches) find(name, server, region string) ([]armoryHit, error) {
	key := region + "|" + server + "|" + strings.ToLower(name)
	s.mu.Lock()
	if kept, ok := s.kept[key]; ok && time.Since(kept.at) < armorySearchKeep {
		s.mu.Unlock()
		return kept.hits, nil
	}
	s.mu.Unlock()
	hits := []armoryHit{}
	for _, at := range searches(server, region) {
		if err := s.slot(); err != nil {
			return nil, err
		}
		query := "keyword=" + strings.ReplaceAll(url.QueryEscape(name), "+", "%20") + "&serverId=" + strconv.Itoa(at.serverId) + "&region=" + at.region + "&localeInfo=en-US&page=1&size=" + strconv.Itoa(searchPageSize)
		res, err := send(call{method: "GET", url: searchURL() + "?" + query, headers: map[string]string{"accept": "application/json", "user-agent": userAgent}, timeout: 10 * time.Second, limit: 1 << 20})
		if err != nil {
			return nil, err
		}
		if res.status != 200 {
			return nil, errors.New("The official character search is unavailable (" + strconv.Itoa(res.status) + ").")
		}
		found, _ := res.json().(map[string]any)
		for _, hit := range jsonList(found["list"]) {
			id, err := url.QueryUnescape(jsonText(hit, "characterId", 200))
			serverId := int(number(hit["serverId"]))
			if err != nil || !armoryIds.MatchString(id) || serverId != at.serverId {
				continue
			}
			hits = append(hits, armoryHit{Name: jsonText(hit, "name", 40), Level: whole(hit["level"]), Race: whole(hit["race"]), Server: server, ServerId: serverId, Region: at.region, CharacterId: id})
		}
	}
	exact := strings.ToLower(name)
	slices.SortStableFunc(hits, func(a, b armoryHit) int {
		return boolOrder(strings.ToLower(b.Name) == exact) - boolOrder(strings.ToLower(a.Name) == exact)
	})
	hits = hits[:min(len(hits), 20)]
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.kept) >= 500 {
		for k, kept := range s.kept {
			if time.Since(kept.at) >= armorySearchKeep {
				delete(s.kept, k)
			}
		}
		if len(s.kept) >= 500 {
			s.kept = map[string]searchAnswer{}
		}
	}
	s.kept[key] = searchAnswer{hits: hits, at: time.Now()}
	return hits, nil
}

func boolOrder(b bool) int {
	if b {
		return 1
	}
	return 0
}

// armoryName checks a searched name: 2 to 16 letters or digits.
func armoryName(name string) bool {
	runes := []rune(name)
	if len(runes) < 2 || len(runes) > 16 {
		return false
	}
	for _, r := range runes {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

// armorySearchRoute answers GET /api/odyle/armory/search?name=&server=&region= (a server
// name and an Odyle region, as characters keep them): the characters the official search
// lists. Public; rate limited per address.
func armorySearchRoute(e *core.RequestEvent) error {
	q := e.Request.URL.Query()
	name, server, region := trim(q.Get("name")), q.Get("server"), q.Get("region")
	if !armoryName(name) {
		return badRequest("Search a character name of 2 to 16 letters or digits.")
	}
	if len(searches(server, region)) == 0 {
		return badRequest("Choose the region and server of the character.")
	}
	if readSettings(e.App).ArmoryPaused {
		return unavailable("The armory is paused for now. Try again later.")
	}
	hits, err := stateOf(e.App).armorySearch.find(name, server, region)
	if errors.Is(err, errArmoryBusy) {
		return unavailable("Many lookups at the moment. Try again in a minute.")
	}
	if err != nil {
		warn(e.App, "Odyle armory search failed", "error", message(err))
		return unavailable("The official character search did not answer. Try again in a minute.")
	}
	return e.JSON(200, map[string]any{"results": hits})
}

// armoryServersRoute answers GET /api/odyle/armory/servers: the servers of each region by
// race, for the armory's search form.
func armoryServersRoute(e *core.RequestEvent) error {
	regions := []string{"GLOBAL_NA", "GLOBAL_NAW", "GLOBAL_EU", "GLOBAL_SA", "GLOBAL_ASIA"}
	out := []map[string]any{}
	for _, r := range regions {
		out = append(out, map[string]any{"region": r, "elyos": elyos, "asmodian": asmodian})
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=86400")
	return e.JSON(200, map[string]any{"regions": out})
}

// cleanArmory is a job: profiles nobody opened for 30 days are deleted, hidden ones kept, and
// then the images no kept profile names (armoryimages.go).
func cleanArmory(app core.App) (result, error) {
	res, err := app.DB().NewQuery("DELETE FROM armory_profiles WHERE hidden = FALSE AND viewedAt < {:before}").Bind(dbx.Params{"before": ago(armoryKeep)}).Execute()
	if err != nil {
		return result{}, err
	}
	deleted, _ := res.RowsAffected()
	if _, err := cleanArmoryImages(app); err != nil {
		return result{Done: int(deleted)}, err
	}
	return result{Done: int(deleted)}, nil
}

// armoryStatus is the armory's part of the Server status page.
func armoryStatus(app core.App) map[string]any {
	w := stateOf(app).armory
	w.mu.Lock()
	out := map[string]any{"waiting": len(w.waiting), "fetching": w.current != "", "done": w.done, "failed": w.failed, "lastAt": isoTime(w.lastAt), "lastError": w.lastError,
		"lastErrorAt": isoTime(w.errorAt), "blockedUntil": ""}
	if w.blocked.After(time.Now()) {
		out["blockedUntil"] = isoTime(w.blocked)
	}
	w.mu.Unlock()
	var kept, hidden int
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM armory_profiles").Row(&kept)
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM armory_profiles WHERE hidden = TRUE").Row(&hidden)
	out["profiles"], out["hidden"], out["paused"] = kept, hidden, readSettings(app).ArmoryPaused
	out["images"], out["imageBytes"] = armoryImages(app)
	return out
}
