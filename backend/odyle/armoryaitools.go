package odyle

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory AI's tools (armoryai.go): what Claude may do with the armory's data. Each answers
// JSON, or an error Claude reads; none changes anything but the armory's queue (a profile read from
// PLAYNC, as a reader opening it would). Web search and fetch run at Anthropic, when Server controls
// allow them.

// aiLookupWait is how long a tool waits for a profile the armory reads from PLAYNC.
var aiLookupWait = 90 * time.Second

var aiRegionCodes = []string{"eu", "nae", "naw", "la", "as"}

// aiTool is a tool of the armory's own, as Claude reads its description and input.
func aiTool(name, description string, properties map[string]any, required ...string) anthropic.BetaToolUnionParam {
	return anthropic.BetaToolUnionParam{OfTool: &anthropic.BetaToolParam{
		Name:        name,
		Description: anthropic.String(description),
		InputSchema: anthropic.BetaToolInputSchemaParam{Properties: properties, Required: required, ExtraFields: map[string]any{"additionalProperties": false}},
		// The input streams as Claude writes it; runTool checks it.
		EagerInputStreaming: anthropic.Bool(true),
	}}
}

func aiRegionField(description string) map[string]any {
	return map[string]any{"type": "string", "enum": aiRegionCodes, "description": description}
}

// aiTools are the tools Claude may call: the armory's, and the web's when web is on.
func aiTools(web bool) []anthropic.BetaToolUnionParam {
	character := func() map[string]any {
		return map[string]any{
			"region":      aiRegionField("The character's region code, as search_characters lists it."),
			"serverId":    map[string]any{"type": "integer", "description": "The character's server id, as search_characters lists it."},
			"characterId": map[string]any{"type": "string", "description": "PLAYNC's id of the character, exactly as search_characters lists it."},
		}
	}
	compare := character()
	compare["group"] = map[string]any{"type": "string", "enum": []string{"next", "top"}, "description": `"next": the characters a step above in combat power (what to upgrade next); "top": the strongest of the class.`}
	tools := []anthropic.BetaToolUnionParam{
		aiTool("search_characters", "Find AION 2 Global characters by name. Part of a name finds every name holding it. Lists the characters Odyle already knows (with their combat power) in every region, and those PLAYNC's official character search finds in the region (on the server, when given). Each comes with its region, serverId and characterId for the other tools, and its Odyle profile path to link.",
			map[string]any{
				"query":  map[string]any{"type": "string", "description": `The name or part of it, 2 to 16 letters or digits. It may name the server or region too, for example "Kai Lumiel" or "Kai eu".`},
				"region": aiRegionField("The region to search PLAYNC in. Without one, the region the user last chose in the armory is searched, if any."),
				"server": map[string]any{"type": "string", "description": "A server name, to search that server only."},
			}, "query"),
		aiTool("get_character", "Read one character's profile as PLAYNC's official pages list it: class, level, combat power, item level, stats, every equipped item with its stats, enchantment, exceed level, stones and set, the skills on its bar, Daevanion boards, titles, and how its combat power changed. Uses the copy Odyle keeps and asks PLAYNC for a new one when it is older than 6 hours or missing, which can take a minute.",
			character(), "region", "serverId", "characterId"),
		aiTool("top_players", "The strongest characters of a class that Odyle knows, by combat power: from every region, or one region or server. Odyle's list is no full ranking: it holds the characters anyone looked up and those its scout found in PLAYNC's character search.",
			map[string]any{
				"class":  map[string]any{"type": "string", "description": "The class, as PLAYNC names it (for example Chanter or Templar)."},
				"region": aiRegionField("Only this region."),
				"server": map[string]any{"type": "string", "description": "Only this server (with region, or on every region)."},
				"limit":  map[string]any{"type": "integer", "description": "How many, 1 to 50 (15 when left out)."},
			}, "class"),
		aiTool("compare_with_class", "What the stronger characters of a character's class wear, as its profile's Upgrade tab shows: for each slot how many wear something there, the usual grade and the medians of item level, enchantment, exceed level and stones, the items worn and stones engraved most and the stats rolled most; their sets, Daevanion boards, skills and the skills their gear raises; the spread of their combat power and item level. Read the character with get_character too, to say what to upgrade first.",
			compare, "region", "serverId", "characterId", "group"),
	}
	if web {
		tools = append(tools,
			anthropic.BetaToolUnionParam{OfWebSearchTool20260209: &anthropic.BetaWebSearchTool20260209Param{MaxUses: anthropic.Int(5)}},
			anthropic.BetaToolUnionParam{OfWebFetchTool20260209: &anthropic.BetaWebFetchTool20260209Param{MaxUses: anthropic.Int(3)}},
		)
	}
	return tools
}

// aiInstructions are what Claude is told before every conversation: what the armory is, where
// its data comes from, the regions, servers and classes, and how to answer. They change only with
// the day, the servers and classes the armory knows and the web switch, so they stay cached.
func aiInstructions(app core.App, s settings) string {
	book := serversOf(app)
	names := func(race int) string {
		return strings.Join(slices.DeleteFunc(slices.Clone(book.races[race]), func(n string) bool { return n == "" }), ", ")
	}
	classes, _ := rankClasses(app)
	classNames := []string{}
	for _, c := range classes {
		classNames = append(classNames, c.Name)
	}
	if len(classNames) == 0 {
		classNames = []string{"Gladiator", "Templar", "Assassin", "Ranger", "Sorcerer", "Spiritmaster", "Cleric", "Chanter"}
	}
	web := "You cannot search the web on this server: say so when a question needs it."
	if s.AiWeb {
		web = "You may search the web for game knowledge the armory does not hold: patch notes, guides, where items come from, how mechanics work. Prefer official sources (PLAYNC, NCSOFT) and well-known community sites, say where an answer comes from, and say when it may be outdated or about the Korean or Taiwanese servers rather than Global."
	}
	return `You are the AI of Odyle Armory, the character armory of Odyle, a player-made dashboard for AION 2 Global (the North American, European, South American and Asian servers that NCSOFT runs through PLAYNC). You help players find characters, read their gear and compare characters with each other and with the strongest players of their class.

Where the armory's data comes from:
- PLAYNC's official character pages. Odyle reads them and keeps a copy for everyone; each profile says when it was read. Odyle asks PLAYNC slowly, one character at a time, so reading a character Odyle does not keep yet can take a minute.
- Odyle's list of the characters it knows the combat power of (its top players and its search suggestions). It grows as players look characters up and as Odyle's scout reads PLAYNC's character search, but it is no full ranking: say "the strongest Odyle knows", never "the strongest on the server".
- ` + web + `

How to work:
- Use search_characters to find a character by name (part of a name works). When several match and the conversation does not make clear which one is meant, list them briefly and ask.
- Read a character with get_character before saying anything about its gear, stats or skills, and never make up numbers. Read each character of a comparison.
- Use top_players for the strongest of a class, and compare_with_class to see what stronger characters of the class wear (group "next" for the next step up, "top" for the strongest).
- When you compare, be concrete: slot by slot, the grade, enchantment, exceed level, item level, stones and rolled stats that differ, and what matters most for combat power.
- If a tool fails or PLAYNC is slow, say so plainly and suggest trying again.

Regions (region codes): eu Europe, nae North America East, naw North America West, la South America, as Asia.
Servers (every region uses these names, though not every region has all of them):
- Elyos: ` + names(1) + `
- Asmodians: ` + names(2) + `
Classes: ` + strings.Join(classNames, ", ") + `

How to answer:
- Answer in the language of the user's last message (most often Czech or English).
- Be concise. Write Markdown: short paragraphs, bullet lists, **bold**, and tables for side-by-side comparisons (a few columns at most). No images and no HTML.
- Link every character you name to its Odyle profile with a Markdown link to the path a tool gave you, for example [Kai](/armory/eu/2304/AbCd...). Never make up a path.
- Write combat power as CP.
- Stay with AION 2 and its characters; decline other requests politely.

Today is ` + time.Now().UTC().Format("2 January 2006") + ` (UTC).`
}

// runTool runs one tool Claude called with its input (JSON, which it checks).
func (q *aiQuestion) runTool(ctx context.Context, name string, input json.RawMessage) (string, error) {
	var in struct {
		Query       string `json:"query"`
		Region      string `json:"region"`
		Server      string `json:"server"`
		ServerId    int    `json:"serverId"`
		CharacterId string `json:"characterId"`
		Class       string `json:"class"`
		Group       string `json:"group"`
		Limit       int    `json:"limit"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return "", fmt.Errorf("the input of %s is not valid JSON: %v", name, err)
	}
	if in.Region != "" && !slices.Contains(aiRegionCodes, in.Region) {
		return "", fmt.Errorf("region must be one of %s", strings.Join(aiRegionCodes, ", "))
	}
	var out any
	var err error
	switch name {
	case "search_characters":
		out, err = q.searchCharacters(in.Query, in.Region, in.Server)
	case "get_character":
		out, err = q.getCharacter(ctx, in.Region, in.ServerId, in.CharacterId)
	case "top_players":
		out, err = q.topPlayers(in.Class, in.Region, in.Server, in.Limit)
	case "compare_with_class":
		out, err = q.compareWithClass(in.Region, in.ServerId, in.CharacterId, in.Group)
	default:
		return "", fmt.Errorf("there is no tool named %s", name)
	}
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(out)
	return string(raw), err
}

// aiCharacter is a character as the tools list it.
type aiCharacter struct {
	Name        string `json:"name"`
	Class       string `json:"class,omitempty"`
	Level       int64  `json:"level,omitempty"`
	CombatPower int64  `json:"combatPower,omitempty"`
	ItemLevel   int64  `json:"itemLevel,omitempty"`
	Server      string `json:"server"`
	Region      string `json:"region"`
	ServerId    int    `json:"serverId"`
	CharacterId string `json:"characterId"`
	Path        string `json:"path"`
	Known       bool   `json:"knownToOdyle"`
	OnPlaync    bool   `json:"foundOnPlaync,omitempty"`
}

func profilePathOf(region string, serverId int, characterId string) string {
	return "/armory/" + region + "/" + strconv.Itoa(serverId) + "/" + characterId
}

// searchCharacters finds characters by name: those the armory knows, and those PLAYNC's search
// lists in the region (asked, or the one the reader last chose).
func (q *aiQuestion) searchCharacters(query, code, server string) (map[string]any, error) {
	book := serversOf(q.app)
	parsed, err := parseQuery(book, cut(query, 80))
	if err != nil {
		return nil, err
	}
	if code != "" {
		parsed.region = regionOfCode(code).odyle
	}
	if server != "" {
		if parsed.server = book.serverNamed(trim(server)); parsed.server == "" {
			return nil, fmt.Errorf("no server is named %q", server)
		}
	}
	q.out.status("Searching for {name}…", map[string]any{"name": parsed.name})
	known, err := knownCharacters(q.app, parsed, q.focus.region, 15)
	if err != nil {
		return nil, err
	}
	list, index := []aiCharacter{}, map[string]int{}
	for _, c := range known {
		index[armoryKey(c.ServerId, c.CharacterId)] = len(list)
		list = append(list, aiCharacter{Name: c.Name, Class: c.Class, Level: c.Level, CombatPower: c.CombatPower, ItemLevel: c.ItemLevel, Server: c.Server, Region: c.Region, ServerId: c.ServerId, CharacterId: c.CharacterId, Path: profilePathOf(c.Region, c.ServerId, c.CharacterId), Known: true})
	}
	notes := []string{}
	region := cmpOr(parsed.region, q.focus.region)
	switch {
	case region == "":
		notes = append(notes, "No region was given, so PLAYNC's search was not asked: these are only the characters Odyle knows. Ask for the region, or search again with one, to find others.")
	case readSettings(q.app).ArmoryPaused:
		notes = append(notes, "The armory is paused, so PLAYNC's search was not asked: these are only the characters Odyle knows.")
	case parsed.server != "" && len(book.searches(parsed.server, region)) == 0:
		notes = append(notes, "That server is not in that region, so PLAYNC's search was not asked.")
	default:
		hits, err := stateOf(q.app).armorySearch.find(book, parsed.name, parsed.server, region)
		if err == nil {
			hits, err = knownHits(q.app, hits)
		}
		if err != nil {
			notes = append(notes, "PLAYNC's search did not answer ("+message(err)+"); these are only the characters Odyle knows.")
			break
		}
		for _, h := range hits {
			if at, ok := index[armoryKey(h.ServerId, h.CharacterId)]; ok {
				list[at].OnPlaync = true
				continue
			}
			index[armoryKey(h.ServerId, h.CharacterId)] = len(list)
			list = append(list, aiCharacter{Name: h.Name, Class: h.Class, Level: h.Level, CombatPower: h.CombatPower, ItemLevel: h.ItemLevel, Server: h.Server, Region: h.Region, ServerId: h.ServerId, CharacterId: h.CharacterId, Path: profilePathOf(h.Region, h.ServerId, h.CharacterId), Known: h.CombatPower > 0, OnPlaync: true})
		}
		notes = append(notes, "PLAYNC's search was asked in "+regionNamed(region).title+".")
	}
	if len(list) == 0 {
		notes = append(notes, "No character was found.")
	}
	return map[string]any{"searched": map[string]string{"name": parsed.name, "server": parsed.server, "region": regionNamed(region).code}, "characters": list, "notes": notes}, nil
}

func cmpOr(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// getCharacter reads a character's profile: the copy the armory keeps, read again from PLAYNC
// (waiting up to aiLookupWait) when it is due, as when a reader opens it.
func (q *aiQuestion) getCharacter(ctx context.Context, code string, serverId int, id string) (map[string]any, error) {
	book := serversOf(q.app)
	server := book.inRegion(code, serverId)
	if server == "" || !armoryIds.MatchString(id) {
		return nil, fmt.Errorf("no character has that region, serverId and characterId: take them from search_characters")
	}
	record, err := keptProfile(q.app, serverId, id)
	if err != nil {
		return nil, err
	}
	if record != nil && record.GetBool("hidden") {
		return nil, fmt.Errorf("this character is not in the armory (its player asked to keep it out)")
	}
	notes := []string{}
	if record == nil || profileDue(record) {
		if readSettings(q.app).ArmoryPaused {
			notes = append(notes, "The armory is paused, so PLAYNC was not asked for a newer copy.")
		} else {
			note, err := q.lookUp(ctx, code, serverId, id, record)
			if err != nil {
				return nil, err
			}
			if note != "" {
				notes = append(notes, note)
			}
			if record, err = keptProfile(q.app, serverId, id); err != nil {
				return nil, err
			}
		}
	}
	var p armoryProfile
	if record == nil || json.Unmarshal([]byte(record.GetString("profile")), &p) != nil || p.Name == "" {
		// Not read yet: what the top players know of it, if anything.
		var c knownCharacter
		if err := q.app.DB().NewQuery("SELECT name, level, class, serverId, region, characterId, combatPower, itemLevel, portrait, checkedAt FROM armory_ranks WHERE serverId = {:server} AND characterId = {:id} AND hidden = FALSE").
			Bind(dbx.Params{"server": serverId, "id": id}).One(&c); err != nil {
			return map[string]any{"path": profilePathOf(code, serverId, id), "notes": append(notes, "Odyle has no copy of this character's profile yet.")}, nil
		}
		return map[string]any{"name": c.Name, "class": c.Class, "level": c.Level, "combatPower": c.CombatPower, "itemLevel": c.ItemLevel, "server": server, "path": profilePathOf(code, serverId, id),
			"notes": append(notes, "Only these numbers are known yet; the full profile (gear, stats) was not read.")}, nil
	}
	out := aiProfileOf(p)
	out["server"], out["region"], out["path"] = server, code, profilePathOf(code, serverId, id)
	if at := record.GetDateTime("fetchedAt"); !at.IsZero() {
		out["readFromPlayncAt"] = isoTime(at.Time())
	}
	if history, err := armoryHistoryOf(q.app, serverId, id); err == nil && len(history) > 1 {
		out["combatPowerHistory"] = history[max(0, len(history)-12):]
	}
	if len(notes) > 0 {
		out["notes"] = notes
	}
	return out, nil
}

// profileDue reports whether a kept profile is read again when opened (armoryRoute): it is older
// than armoryRefresh, in an older shape, or lacks details and is older than armoryIncomplete.
func profileDue(record *core.Record) bool {
	age := time.Since(record.GetDateTime("fetchedAt").Time())
	_, meta := keptJSON(record.GetString("profile"))
	if meta == nil {
		return true
	}
	return age > armoryRefresh || number(meta.Version) < armoryVersion || number(meta.Missing) > 0 && age > armoryIncomplete
}

// lookUp queues a reader's lookup of the character and waits for it, telling the reader where it
// stands; it says what the AI should know when it could not wait for it.
func (q *aiQuestion) lookUp(ctx context.Context, code string, serverId int, id string, record *core.Record) (string, error) {
	who := ""
	if record != nil {
		who = record.GetString("name")
	}
	work, key := stateOf(q.app).armory, armoryKey(serverId, id)
	state := work.ask(q.app, armoryJob{key: key, region: code, serverId: serverId, characterId: id, address: "ai/" + q.user})
	deadline, shown := time.Now().Add(aiLookupWait), ""
	for {
		switch state.State {
		case "missing":
			return "", fmt.Errorf("PLAYNC does not list this character any more (deleted or renamed)")
		case "failed":
			return "PLAYNC did not answer (" + state.Error + "); this is the copy Odyle kept.", nil
		case "busy":
			return "Many lookups are waiting at PLAYNC; this is the copy Odyle kept.", nil
		case "queued", "fetching":
		default:
			return "", nil
		}
		line, params := "Reading {name} from PLAYNC…", map[string]any{"name": who}
		switch {
		case state.State == "queued" && state.Position > 0 && who != "":
			line, params["n"] = "Waiting to read {name} from PLAYNC ({n} ahead)…", state.Position
		case state.State == "queued" && state.Position > 0:
			line, params["n"] = "Waiting to read a character from PLAYNC ({n} ahead)…", state.Position
		case who == "":
			line = "Reading a character from PLAYNC…"
		}
		if key := fmt.Sprint(line, params["n"]); key != shown {
			q.out.status(line, params)
			shown = key
		}
		if time.Now().After(deadline) {
			return "PLAYNC is slow: the newer copy is still being read, so this is the copy Odyle kept. Asked again in a minute, it should be there.", nil
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(1500 * time.Millisecond):
		}
		pending, ok := work.peek(key)
		if !ok {
			return "", nil
		}
		state = pending
	}
}

// aiProfileOf is a profile as Claude reads it: what the armory's pages show, in short.
func aiProfileOf(p armoryProfile) map[string]any {
	lines := func(list []armoryLine) []string {
		out := []string{}
		for _, l := range list {
			switch {
			case l.Exceed:
				out = append(out, l.Name+" "+cmpOr(l.Extra, l.Value)+" (exceed)")
			case l.Min != "":
				out = append(out, l.Name+" "+l.Min+" ~ "+l.Value+map[bool]string{true: " (+" + l.Extra + ")", false: ""}[l.Extra != ""])
			default:
				out = append(out, l.Name+" "+l.Value+map[bool]string{true: " (+" + l.Extra + ")", false: ""}[l.Extra != ""])
			}
		}
		return out
	}
	stones := func(list []armoryStone) []string {
		out := []string{}
		for _, s := range list {
			out = append(out, strings.TrimSpace(s.Name+" "+s.Value)+map[bool]string{true: " (" + s.Grade + ")", false: ""}[s.Grade != ""])
		}
		return out
	}
	gear, sets := []map[string]any{}, map[string]bool{}
	for _, g := range p.Gear {
		item := map[string]any{"slot": g.Slot, "name": g.Name, "grade": g.Grade}
		if g.Enchant > 0 {
			item["enchant"] = g.Enchant
		}
		if g.Exceed > 0 {
			item["exceed"] = g.Exceed
		}
		if g.Level > 0 {
			item["level"] = g.Level
		}
		if d := g.Detail; d != nil {
			item["itemLevel"] = d.ItemLevel
			if d.MaxEnchant > 0 {
				item["maxEnchant"] = d.MaxEnchant
			}
			if d.MaxExceed > 0 {
				item["maxExceed"] = d.MaxExceed
			}
			if len(d.Main) > 0 {
				item["stats"] = lines(d.Main)
			}
			if len(d.Sub) > 0 {
				item["rolledStats"] = lines(d.Sub)
			}
			if d.SoulBind != "" {
				item["soulBinding"] = d.SoulBind
			}
			if d.StoneSlots > 0 || len(d.Stones) > 0 {
				item["stones"] = stones(d.Stones)
				item["stoneSlots"] = d.StoneSlots
			}
			if len(d.GodStones) > 0 {
				item["godstones"] = stones(d.GodStones)
			}
			if len(d.SubSkills) > 0 {
				raised := []string{}
				for _, s := range d.SubSkills {
					raised = append(raised, fmt.Sprintf("%s +%d", s.Name, s.Level))
				}
				item["raisesSkills"] = raised
			}
			if d.Set != nil {
				set := map[string]any{"name": d.Set.Name, "equipped": d.Set.Equipped}
				if !sets[d.Set.Name] && len(d.Set.Bonuses) > 0 {
					sets[d.Set.Name] = true
					bonuses := []string{}
					for _, b := range d.Set.Bonuses {
						bonuses = append(bonuses, fmt.Sprintf("%d pieces: %s", b.Count, strings.Join(b.Effects, "; ")))
					}
					set["bonuses"] = bonuses
				}
				item["set"] = set
			}
			if len(d.Sources) > 0 {
				item["comesFrom"] = d.Sources[:min(3, len(d.Sources))]
			}
		}
		gear = append(gear, item)
	}
	stats := []string{}
	for _, s := range p.Stats {
		name := s.Name
		if s.Deity != "" {
			name += " (" + s.Deity + ")"
		}
		line := fmt.Sprintf("%s %d", name, s.Value)
		if len(s.Effects) > 0 {
			line += ": " + strings.Join(s.Effects, ", ")
		}
		stats = append(stats, line)
	}
	skills, learned := []string{}, 0
	for _, s := range p.Skills {
		if s.Acquired {
			learned++
		}
		if s.Equipped {
			skills = append(skills, fmt.Sprintf("%s Lv %d (%s)", s.Name, s.Level, s.Category))
		}
	}
	boards := []string{}
	for _, b := range p.Boards {
		boards = append(boards, fmt.Sprintf("%s %d/%d nodes open", b.Name, b.Open, b.Total))
	}
	titles := []string{}
	for _, t := range p.Titles.Equipped {
		titles = append(titles, t.Category+": "+t.Name)
	}
	out := map[string]any{"name": p.Name, "class": p.Class, "level": p.Level, "race": p.Race, "combatPower": p.CombatPower, "itemLevel": p.ItemLevel,
		"stats": stats, "gear": gear, "skillsOnBar": skills, "skillsLearned": learned, "daevanion": boards,
		"titles": map[string]any{"owned": p.Titles.Owned, "total": p.Titles.Total, "worn": titles}}
	if p.Legion != "" {
		out["legion"] = p.Legion
	}
	if p.Missing > 0 {
		out["detailsMissing"] = fmt.Sprintf("PLAYNC did not give the details of %d items or boards when it was read", p.Missing)
	}
	return out
}

// topPlayers lists the strongest characters of a class the armory knows, of a region or server.
func (q *aiQuestion) topPlayers(class, code, server string, limit int) (map[string]any, error) {
	classes, err := rankClasses(q.app)
	if err != nil {
		return nil, err
	}
	named, known := "", []string{}
	for _, c := range classes {
		known = append(known, c.Name)
		if strings.EqualFold(c.Name, trim(class)) {
			named = c.Name
		}
	}
	if named == "" {
		return nil, fmt.Errorf("no class is named %q; Odyle knows %s", class, strings.Join(known, ", "))
	}
	if limit < 1 || limit > 50 {
		limit = 15
	}
	book := serversOf(q.app)
	where, params := []string{"class = {:class}", "hidden = FALSE"}, dbx.Params{"class": named, "limit": limit}
	region := regionOfCode(code).odyle
	if server != "" {
		name := book.serverNamed(trim(server))
		if name == "" {
			return nil, fmt.Errorf("no server is named %q", server)
		}
		ids := []any{}
		for _, id := range book.serverIds(name, "") {
			if code == "" || regionOfDigit(id.(int)/100%10).code == code {
				ids = append(ids, id)
			}
		}
		where = append(where, inList("serverId", "server", ids, params))
	} else if region != "" {
		where = append(where, "region = {:region}")
		params["region"] = code
	}
	q.out.status("Listing the strongest {class} characters…", map[string]any{"class": named})
	rows := []knownCharacter{}
	if err := q.app.DB().NewQuery("SELECT name, level, class, serverId, region, characterId, combatPower, itemLevel, portrait, checkedAt FROM armory_ranks WHERE " + strings.Join(where, " AND ") + " ORDER BY combatPower DESC, id LIMIT {:limit}").
		Bind(params).All(&rows); err != nil {
		return nil, err
	}
	var total int
	if err := q.app.DB().NewQuery("SELECT COUNT(*) FROM armory_ranks WHERE " + strings.Join(where, " AND ")).Bind(params).Row(&total); err != nil {
		return nil, err
	}
	list := []map[string]any{}
	for i, r := range rows {
		list = append(list, map[string]any{"place": i + 1, "name": r.Name, "level": r.Level, "combatPower": r.CombatPower, "itemLevel": r.ItemLevel, "server": book.name(r.ServerId), "region": r.Region,
			"serverId": r.ServerId, "characterId": r.CharacterId, "path": profilePathOf(r.Region, r.ServerId, r.CharacterId)})
	}
	return map[string]any{"class": named, "charactersOdyleKnows": total, "players": list}, nil
}

// compareWithClass is the Upgrade tab's comparison of a character with the stronger characters of
// its class (upgrades.go), in short.
func (q *aiQuestion) compareWithClass(code string, serverId int, id, group string) (map[string]any, error) {
	if serversOf(q.app).inRegion(code, serverId) == "" || !armoryIds.MatchString(id) {
		return nil, fmt.Errorf("no character has that region, serverId and characterId: take them from search_characters")
	}
	if group != "top" {
		group = "next"
	}
	var class string
	if err := q.app.DB().NewQuery("SELECT class FROM armory_ranks WHERE serverId = {:server} AND characterId = {:id} AND hidden = FALSE").Bind(dbx.Params{"server": serverId, "id": id}).Row(&class); err != nil || class == "" {
		return nil, fmt.Errorf("the class of this character is not known yet: read it with get_character first")
	}
	q.out.status("Comparing with the stronger {class} characters…", map[string]any{"class": class})
	ref, err := stateOf(q.app).upgrades.of(q.app, class, serverId, id, group == "next")
	if err != nil {
		return nil, err
	}
	ref.CombatPowers = nil
	players := []map[string]any{}
	for _, p := range ref.Players[:min(10, len(ref.Players))] {
		players = append(players, map[string]any{"name": p.Name, "combatPower": p.CombatPower, "itemLevel": p.ItemLevel, "server": p.Server, "path": profilePathOf(p.Region, p.ServerId, p.CharacterId)})
	}
	raw, err := json.Marshal(ref)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	delete(out, "combatPowers")
	out["players"] = players
	if ref.Sample == 0 {
		out["notes"] = []string{"Odyle has read the gear of no stronger " + class + " character yet."}
	}
	return out, nil
}
