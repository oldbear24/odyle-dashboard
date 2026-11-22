package odyle

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

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

// whole is a count, level or id PLAYNC sends as a number or as text: 0 for anything negative or
// not a number ("NaN"), and at most 2^53, past which an int64 would overflow to a negative one.
func whole(v any) int64 {
	n := number(v)
	if math.IsNaN(n) || n <= 0 {
		return 0
	}
	return int64(min(n, 1<<53))
}

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
// items' and boards' details (readItem, readBoard); equipment nil reads the info page alone
// (the scout's check of a character's combat power). An answer without the character's name,
// or with combat power but no equipped item, is not a profile as PLAYNC lists them (its
// format changed, or the page failed): errArmoryAnswer, so the kept one stays.
func readArmory(info, equipment map[string]any) (armoryProfile, error) {
	profile := jsonObject(info["profile"])
	p := armoryProfile{Version: armoryVersion, Name: jsonText(profile, "characterName", 40), Level: whole(profile["characterLevel"]), Class: jsonText(profile, "className", 40), Race: jsonText(profile, "raceName", 40),
		Gender: jsonText(profile, "genderName", 20), Server: jsonText(profile, "serverName", 40), Title: jsonText(profile, "titleName", 60), TitleGrade: jsonText(profile, "titleGrade", 20), Legion: jsonText(profile, "regionName", 40), CombatPower: whole(profile["combatPower"]),
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
	if equipment != nil && p.CombatPower > 0 && len(p.Gear) == 0 {
		return armoryProfile{}, errArmoryAnswer
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

// The items and boards that have a page of details on PLAYNC.
func (g *armoryGear) detailed() bool  { return g.id > 0 && g.order > 0 }
func (b *armoryBoard) detailed() bool { return b.Id > 0 && b.Open > 0 }

// detailArmory asks PLAYNC for the details of each equipped item and, with withBoards, of each
// board with open nodes, armoryStep apart. A detail PLAYNC does not give leaves its item or board
// without one, counted in the profile's Missing; more of them than armoryDetailsLost allows is
// errArmoryAnswer (PLAYNC's pages changed or fail), so the kept profile stays. PLAYNC refusing
// the server ends the lookup.
func detailArmory(p *armoryProfile, j armoryJob, track *armoryTrack, withBoards bool) error {
	var refused armoryRefused
	items, boards := p.detailed()
	if !withBoards {
		boards = 0
	}
	p.Missing = 0
	track.begin("items", items, 1)
	for i := range p.Gear {
		g := &p.Gear[i]
		if !g.detailed() {
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
		if g.Detail == nil {
			p.Missing++
		}
		track.tick()
	}
	track.begin("boards", boards, 1)
	for i := range p.Boards {
		b := &p.Boards[i]
		if !withBoards || !b.detailed() {
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
		// A board with open nodes lists them.
		if len(b.Nodes) == 0 {
			p.Missing++
		}
		track.tick()
	}
	if p.Missing > armoryDetailsLost(items+boards) {
		return errArmoryAnswer
	}
	return nil
}

// armoryDetailsLost is how many of a lookup's pages of details may fail before it fails: one,
// or a quarter of them (5 of the some 20 items and 4 boards of a character at the level cap).
// One page failing now and then is PLAYNC's; more is a change of its pages or a failure that
// would keep a profile without most of its details.
func armoryDetailsLost(pages int) int { return max(1, pages/4) }

// detailed counts the items and boards whose pages a lookup asks for.
func (p *armoryProfile) detailed() (items, boards int) {
	for i := range p.Gear {
		if p.Gear[i].detailed() {
			items++
		}
	}
	for i := range p.Boards {
		if p.Boards[i].detailed() {
			boards++
		}
	}
	return items, boards
}
