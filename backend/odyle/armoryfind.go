package odyle

import (
	"slices"
	"strings"
	"time"
	"unicode"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory's one search box (src/armory.js armorySearch): a reader types a name, or part of
// one, and may add the server or the region in the same box ("Kai Lumiel", "Kai eu", "Kai,
// Lumiel EU"). While they type, the characters Odyle already knows (armory_ranks, every region)
// are suggested at once without asking PLAYNC (suggestRoute); the search itself
// (armorySearchRoute) asks PLAYNC's character search, which finds names holding the text, on the
// server named or on every server of the region.

// armoryQuery is what a search box's text asks for: a name (or part of one), and the server and
// the region it named, "" for any.
type armoryQuery struct {
	name, server, region string
}

// regionWords are the words a search box takes for a region (Odyle's names).
var regionWords = map[string]string{
	"eu": "GLOBAL_EU", "europe": "GLOBAL_EU",
	"na": "GLOBAL_NA", "nae": "GLOBAL_NA", "naeast": "GLOBAL_NA",
	"naw": "GLOBAL_NAW", "nawest": "GLOBAL_NAW",
	"sa": "GLOBAL_SA", "la": "GLOBAL_SA", "southamerica": "GLOBAL_SA",
	"asia": "GLOBAL_ASIA", "as": "GLOBAL_ASIA",
}

// errQueryWords is a search box's text naming more than one character.
var errQueryWords = badRequest("Search one character name, optionally with its server, for example Kai Lumiel.")

// parseQuery reads a search box's text. Words are split at anything but letters and digits; from
// the last word on, a word that names a server (any case) is the server, one that names a region
// the region, as long as another word is left for the name: "Lumiel" alone searches for characters
// named so. One name and
// at most one server and region; the name is 2 to 16 letters or digits.
func parseQuery(book serverBook, text string) (armoryQuery, error) {
	words := strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	if len(words) == 0 || len(words) > 4 {
		return armoryQuery{}, errQueryWords
	}
	// From the last word: "Lumiel Siel" is Lumiel on Siel.
	var q armoryQuery
	names := []string{}
	for i := len(words) - 1; i >= 0; i-- {
		word := words[i]
		if region, ok := regionWords[strings.ToLower(word)]; ok && q.region == "" {
			q.region = region
			names = append(names, "")
			continue
		}
		if server := book.serverNamed(word); server != "" && q.server == "" {
			q.server = server
			names = append(names, "")
			continue
		}
		names = append(names, word)
	}
	left := slices.DeleteFunc(slices.Clone(names), func(s string) bool { return s == "" })
	switch {
	case len(left) == 1:
		q.name = left[0]
	case len(left) > 1:
		return armoryQuery{}, errQueryWords
	default:
		// Nothing but a server or region: the first word is the name ("Lumiel" may be a character).
		q.name = words[0]
		if strings.EqualFold(q.server, q.name) {
			q.server = ""
		} else if regionWords[strings.ToLower(q.name)] == q.region {
			q.region = ""
		}
	}
	if !armoryName(q.name) {
		return armoryQuery{}, badRequest("Search a character name of 2 to 16 letters or digits.")
	}
	return q, nil
}

// serverNamed is the server's name as the book spells it, for a name in any case, or "".
func (b serverBook) serverNamed(word string) string {
	for _, race := range []int{1, 2} {
		for _, name := range b.races[race] {
			if name != "" && strings.EqualFold(name, word) {
				return name
			}
		}
	}
	return ""
}

// serverIds are the ids a server name has, in a region or (region "") in every region.
func (b serverBook) serverIds(server, region string) []any {
	race, place := b.place(server)
	if race == 0 {
		return nil
	}
	out := []any{}
	for _, r := range gameRegions {
		if region == "" || r.odyle == region {
			out = append(out, race*1000+r.digit*100+place)
		}
	}
	return out
}

// regionCodes are PLAYNC's search region codes of an Odyle region (GLOBAL_NA: East and West).
func regionCodes(region string) []any {
	out := []any{}
	for _, r := range searchRegions(region) {
		out = append(out, r.code)
	}
	return out
}

// knownCharacter is a character the armory knows (armory_ranks), as a suggestion or a search hit
// shows it.
type knownCharacter struct {
	Name        string `db:"name" json:"name"`
	Level       int64  `db:"level" json:"level"`
	Class       string `db:"class" json:"class"`
	ClassIcon   string `db:"-" json:"classIcon"`
	Server      string `db:"-" json:"server"`
	ServerId    int    `db:"serverId" json:"serverId"`
	Region      string `db:"region" json:"region"`
	CharacterId string `db:"characterId" json:"characterId"`
	CombatPower int64  `db:"combatPower" json:"combatPower"`
	ItemLevel   int64  `db:"itemLevel" json:"itemLevel"`
	Portrait    string `db:"portrait" json:"portrait"`
	CheckedAt   string `db:"checkedAt" json:"checkedAt"`
}

// knownCharacters are the characters the armory knows whose name holds the query's name (any case
// for Latin letters), on its server and region when it names them, at most limit: the name itself
// first, then those of the region the reader chose (prefer, an Odyle region), names that start with
// it and the strongest. A scan of the name index (1791763289_armory_ai.go), which holds everything
// listed, so the builds are never read.
func knownCharacters(app core.App, q armoryQuery, prefer string, limit int) ([]knownCharacter, error) {
	book := serversOf(app)
	where := []string{"hidden = FALSE", "name LIKE {:like} ESCAPE '\\'"}
	params := dbx.Params{"like": "%" + likeText(q.name) + "%", "prefix": likeText(q.name) + "%", "exact": q.name, "limit": limit}
	if q.server != "" {
		ids := book.serverIds(q.server, q.region)
		if len(ids) == 0 {
			return []knownCharacter{}, nil
		}
		where = append(where, inList("serverId", "server", ids, params))
	} else if q.region != "" {
		where = append(where, inList("region", "region", regionCodes(q.region), params))
	}
	// An integer in ORDER BY would name a column: no region chosen leaves the term out.
	preferred := ""
	if codes := regionCodes(prefer); len(codes) > 0 {
		preferred = inList("region", "prefer", codes, params) + " DESC, "
	}
	out := []knownCharacter{}
	err := app.DB().NewQuery("SELECT name, level, class, serverId, region, characterId, combatPower, itemLevel, portrait, checkedAt FROM armory_ranks " +
		"WHERE " + strings.Join(where, " AND ") + " ORDER BY name = {:exact} COLLATE NOCASE DESC, " + preferred + "name LIKE {:prefix} ESCAPE '\\' DESC, combatPower DESC LIMIT {:limit}").
		Bind(params).All(&out)
	if err != nil {
		return nil, err
	}
	icons := classIcons(app)
	for i := range out {
		c := &out[i]
		c.Server, c.ClassIcon = book.name(c.ServerId), icons[c.Class]
		if at, err := time.Parse(stampLayout, c.CheckedAt); err == nil {
			c.CheckedAt = isoTime(at)
		}
	}
	return out, nil
}

// likeText is text for a LIKE pattern, its wildcards escaped with \.
func likeText(s string) string {
	return strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(s)
}

// inList is "column IN ({:name0}, {:name1}…)" with the values bound to params.
func inList(column, name string, values []any, params dbx.Params) string {
	marks := make([]string, len(values))
	for i, v := range values {
		key := name + string(rune('a'+i))
		params[key], marks[i] = v, "{:"+key+"}"
	}
	return column + " IN (" + strings.Join(marks, ", ") + ")"
}

// suggestRoute answers GET /api/odyle/armory/suggest?q=&region=: up to 8 characters the armory
// already knows whose name holds the text typed (with its server or region, when the text names
// them), for the search box to suggest while the reader types; region (an Odyle region, optional)
// lists those of the region the reader chose first. It never asks PLAYNC, so it answers even while
// the armory is paused; text that is no search yet answers no suggestion. Public; rate limited per
// address (1791763289_armory_ai.go).
func suggestRoute(e *core.RequestEvent) error {
	text, prefer := e.Request.URL.Query().Get("q"), e.Request.URL.Query().Get("region")
	q, err := parseQuery(serversOf(e.App), cut(text, 80))
	if err != nil {
		return e.JSON(200, map[string]any{"results": []knownCharacter{}})
	}
	known, err := knownCharacters(e.App, q, prefer, 8)
	if err != nil {
		return err
	}
	return e.JSON(200, map[string]any{"results": known, "query": map[string]string{"name": q.name, "server": q.server, "region": q.region}})
}
