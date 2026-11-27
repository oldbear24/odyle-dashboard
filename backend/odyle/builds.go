package odyle

import (
	"bytes"
	"encoding/json"
	"regexp"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
)

// Builds (src/builds.js, /builds): characters a player puts together by clicking, from what the
// armory keeps of a class (buildcatalog.go): the gear slot by slot (item, enchantment, exceed
// level, stones, soul binding, the skills it raises), the skills with their levels and which are
// on the skill bar, the open nodes of each Daevanion board, and notes. A build is a plan of its
// own: it changes nothing of a character, and none of a character's values is typed in (R1). It
// may start as a copy of an armory profile (from), which the build page compares it with.
//
// A build belongs to its account and is private until its player shares it: its link then names
// a random code (share), which anyone with the link opens without signing in, and a signed-in
// reader can copy into their own builds. Stopping the share ends the link; sharing again makes a
// new one. Builds go with the account, and the data download lists them.

const (
	buildLimit     = 50 // builds an account keeps
	buildShareSize = 16 // characters of a share code
	buildNotes     = 2000
	buildGearMax   = 32
	buildSkillsMax = 160
	buildBoardsMax = 24
	buildNodesMax  = 225 // a board is 15 by 15
)

// buildSlots are the gear slots a build fills: the paper doll's (src/armory.js).
var buildSlots = map[string]bool{
	"MainHand": true, "SubHand": true, "Helmet": true, "Shoulder": true, "Torso": true, "Pants": true, "Gloves": true, "Boots": true, "Cape": true, "Belt": true,
	"Necklace": true, "Amulet": true, "Earring1": true, "Earring2": true, "Ring1": true, "Ring2": true, "Bracelet1": true, "Bracelet2": true, "Rune1": true, "Rune2": true,
	"Arcana1": true, "Arcana2": true, "Arcana3": true, "Arcana4": true, "Arcana5": true, "Wings": true, "Pet": true,
}

var (
	buildShareCode = regexp.MustCompile(`^[A-Z2-9]{16}$`)
	buildNode      = regexp.MustCompile(`^(?:1[0-9]|2[0-9]|30|[0-9]),(?:1[0-9]|2[0-9]|30|[0-9])$`)
	buildGrade     = regexp.MustCompile(`^[A-Za-z]{0,20}$`)
)

// buildPlan is what a build holds (builds.plan).
type buildPlan struct {
	Gear   []buildGear  `json:"gear"`
	Skills []buildSkill `json:"skills"`
	Boards []buildBoard `json:"boards"`
	Notes  string       `json:"notes"`
	From   *buildFrom   `json:"from,omitempty"`
}

// An item of a build in a slot, by its name and grade as the armory knows it, with the
// enchantment and exceed level, the stones engraved, the soul binding's rolled stats and the
// skills it raises; a pet has its level.
type buildGear struct {
	Slot    string       `json:"slot"`
	Name    string       `json:"name"`
	Grade   string       `json:"grade"`
	Enchant int64        `json:"enchant"`
	Exceed  int64        `json:"exceed"`
	Level   int64        `json:"level,omitempty"`
	Stones  []buildStone `json:"stones"`
	Gods    []buildStone `json:"gods"`
	Sub     []buildLine  `json:"sub"`
	Skills  []buildRaise `json:"skills"`
}

type buildStone struct {
	Name  string `json:"name"`
	Value string `json:"value,omitempty"`
	Grade string `json:"grade"`
}

type buildLine struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type buildRaise struct {
	Name  string `json:"name"`
	Level int64  `json:"level"`
}

// A skill of the build: its level and whether it is on the skill bar (a stigma: chosen).
type buildSkill struct {
	Name  string `json:"name"`
	Level int64  `json:"level"`
	Bar   bool   `json:"bar"`
}

// A Daevanion board of the build (its id, as PLAYNC's pages name it) and its open nodes, "row,column".
type buildBoard struct {
	Id    int64    `json:"id"`
	Nodes []string `json:"nodes"`
}

// The armory profile a build started from.
type buildFrom struct {
	Region      string `json:"region"`
	ServerId    int    `json:"serverId"`
	CharacterId string `json:"characterId"`
	Name        string `json:"name"`
}

var errPlan = badRequest("This build holds something Odyle cannot keep. Reload the page and try again.")

// readPlan reads and checks a build's plan as a client sends it: only the fields above, within
// their limits; names as the armory spells them (visible text, trimmed).
func readPlan(value any) (buildPlan, error) {
	var p buildPlan
	raw, err := json.Marshal(value)
	if err != nil || value == nil {
		return p, errPlan
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&p) != nil {
		return p, errPlan
	}
	if err := p.check(); err != nil {
		return p, err
	}
	return p, nil
}

// name checks a name the armory gave (an item's, a stat's, a skill's) and gives it trimmed.
func planName(s *string, max int, required bool) bool {
	*s = trim(visible(*s))
	return (*s != "" || !required) && length(*s) <= max
}

func (p *buildPlan) check() error {
	if len(p.Gear) > buildGearMax || len(p.Skills) > buildSkillsMax || len(p.Boards) > buildBoardsMax {
		return errPlan
	}
	slots := map[string]bool{}
	for i := range p.Gear {
		g := &p.Gear[i]
		if !buildSlots[g.Slot] || slots[g.Slot] || !planName(&g.Name, 80, true) || !buildGrade.MatchString(g.Grade) ||
			g.Enchant < 0 || g.Enchant > 30 || g.Exceed < 0 || g.Exceed > 10 || g.Level < 0 || g.Level > 100 ||
			len(g.Stones) > 8 || len(g.Gods) > 4 || len(g.Sub) > 12 || len(g.Skills) > 8 {
			return errPlan
		}
		slots[g.Slot] = true
		for _, list := range [][]buildStone{g.Stones, g.Gods} {
			for j := range list {
				if !planName(&list[j].Name, 80, true) || !planName(&list[j].Value, 20, false) || !buildGrade.MatchString(list[j].Grade) {
					return errPlan
				}
			}
		}
		for j := range g.Sub {
			if !planName(&g.Sub[j].Name, 80, true) || !planName(&g.Sub[j].Value, 20, true) {
				return errPlan
			}
		}
		for j := range g.Skills {
			if !planName(&g.Skills[j].Name, 80, true) || g.Skills[j].Level < 0 || g.Skills[j].Level > 50 {
				return errPlan
			}
		}
		g.Stones, g.Gods, g.Sub, g.Skills = orEmpty(g.Stones), orEmpty(g.Gods), orEmpty(g.Sub), orEmpty(g.Skills)
	}
	skills := map[string]bool{}
	for i := range p.Skills {
		s := &p.Skills[i]
		if !planName(&s.Name, 80, true) || skills[s.Name] || s.Level < 0 || s.Level > 50 {
			return errPlan
		}
		skills[s.Name] = true
	}
	boards := map[int64]bool{}
	for i := range p.Boards {
		b := &p.Boards[i]
		if b.Id < 1 || b.Id > 1_000_000 || boards[b.Id] || len(b.Nodes) > buildNodesMax {
			return errPlan
		}
		boards[b.Id] = true
		nodes := map[string]bool{}
		for _, n := range b.Nodes {
			if !buildNode.MatchString(n) || nodes[n] {
				return errPlan
			}
			nodes[n] = true
		}
		b.Nodes = orEmpty(b.Nodes)
	}
	if p.Notes = keptLines(p.Notes); length(p.Notes) > buildNotes {
		return badRequest("The notes can be up to 2,000 characters.")
	}
	if f := p.From; f != nil {
		if regionOfCode(f.Region).digit == 0 || f.ServerId < 1000 || f.ServerId > 2999 || !armoryIds.MatchString(f.CharacterId) || !planName(&f.Name, 40, true) {
			return errPlan
		}
	}
	p.Gear, p.Skills, p.Boards = orEmpty(p.Gear), orEmpty(p.Skills), orEmpty(p.Boards)
	return nil
}

// orEmpty is the list, or an empty one for none, so it answers [] in JSON.
func orEmpty[T any](list []T) []T {
	if list == nil {
		return []T{}
	}
	return list
}

// planOf is the plan a build keeps; an empty one if it cannot be read.
func planOf(r *core.Record) buildPlan {
	var p buildPlan
	_ = r.UnmarshalJSONField("plan", &p)
	p.Gear, p.Skills, p.Boards = orEmpty(p.Gear), orEmpty(p.Skills), orEmpty(p.Boards)
	return p
}

// buildName is a build's name: up to 60 characters, inner whitespace collapsed.
func buildName(value any) (string, error) {
	name, err := text(value, "Build name", 60)
	if err != nil {
		return "", err
	}
	return collapse(name), nil
}

// buildClass is a class as PLAYNC names it (upgrades.go).
func buildClass(value any) (string, error) {
	class, _ := value.(string)
	if !upgradeClass.MatchString(class) {
		return "", badRequest("Choose a class for the build.")
	}
	return class, nil
}

// buildJSON is a build as its owner gets it: with its plan, or (summary) with what it holds counted.
func buildJSON(r *core.Record, summary bool) map[string]any {
	p := planOf(r)
	out := map[string]any{"id": r.Id, "name": r.GetString("name"), "class": r.GetString("class"), "share": r.GetString("share"),
		"created": r.GetString("created"), "updated": r.GetString("updated")}
	if !summary {
		out["plan"] = p
		return out
	}
	nodes, bar := 0, 0
	for _, b := range p.Boards {
		nodes += len(b.Nodes)
	}
	for _, s := range p.Skills {
		if s.Bar {
			bar++
		}
	}
	out["gear"], out["nodes"], out["bar"], out["from"] = len(p.Gear), nodes, bar, p.From
	return out
}

// ownBuild is a build of the account, or why it is not.
func ownBuild(app core.App, userId, id string) (*core.Record, error) {
	r, err := app.FindRecordById("builds", id)
	if err != nil {
		return nil, notFound("This build no longer exists.")
	}
	if r.GetString("user") != userId {
		return nil, forbidden("This build belongs to another account.")
	}
	return r, nil
}

// buildsRoute answers GET /api/odyle/builds: the account's builds, the one changed last first,
// each with what it holds counted; how many it may keep; the classes the armory knows (rankClasses).
func buildsRoute(e *core.RequestEvent) error {
	return run(e, func() error {
		found, err := e.App.FindRecordsByFilter("builds", "user = {:user}", "-updated,-created", 0, 0, dbx.Params{"user": e.Auth.Id})
		if err != nil {
			return err
		}
		list := make([]any, len(found))
		for i, r := range found {
			list[i] = buildJSON(r, true)
		}
		classes, err := rankClasses(e.App)
		if err != nil {
			return err
		}
		return e.JSON(200, map[string]any{"builds": list, "limit": buildLimit, "classes": classes})
	})
}

// buildRoute answers GET /api/odyle/builds/{id}: one of the account's builds with its plan.
func buildRoute(e *core.RequestEvent) error {
	return run(e, func() error {
		r, err := ownBuild(e.App, e.Auth.Id, e.Request.PathValue("id"))
		if err != nil {
			return err
		}
		return e.JSON(200, map[string]any{"build": buildJSON(r, false)})
	})
}

// sharedBuildRoute answers GET /api/odyle/builds/shared/{code}: a shared build for anyone with its
// link, signed in or not, without its account; mine (with its id) when the reader owns it.
func sharedBuildRoute(e *core.RequestEvent) error {
	return run(e, func() error {
		code := e.Request.PathValue("code")
		if !buildShareCode.MatchString(code) {
			return notFound("This build is not shared any more.")
		}
		r, err := e.App.FindFirstRecordByFilter("builds", "share = {:code}", dbx.Params{"code": code})
		if err != nil {
			return notFound("This build is not shared any more.")
		}
		out := map[string]any{"name": r.GetString("name"), "class": r.GetString("class"), "plan": planOf(r), "updated": r.GetString("updated"), "share": code}
		if e.Auth != nil && e.Auth.Collection().Name == "users" && r.GetString("user") == e.Auth.Id {
			out["mine"], out["id"] = true, r.Id
		}
		e.Response.Header().Set("Cache-Control", "no-store")
		return e.JSON(200, map[string]any{"build": out})
	})
}

// buildChange is POST /api/odyle/build: { name, class, plan } makes a build; { copy: code, name? }
// copies a shared build into the account; { id, name?, plan? } changes one; { id, share: true }
// shares it (its link's code in share), { id, share: false } ends its link; { id, remove: true }
// deletes it. Answers { build } with its plan, or { removed: id }.
func buildChange(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if b.has("copy") {
			return copyBuild(app, user.Id, b)
		}
		if !b.set("id") {
			return newBuild(app, user.Id, b)
		}
		r, err := ownBuild(app, user.Id, b.str("id"))
		if err != nil {
			return nil, err
		}
		share, sharing := b.boolean("share")
		switch {
		case b.isTrue("remove"):
			if err := app.Delete(r); err != nil {
				return nil, err
			}
			return map[string]any{"removed": r.Id}, nil
		case sharing:
			if !share {
				r.Set("share", "")
			} else if r.GetString("share") == "" {
				r.Set("share", security.RandomStringWithAlphabet(buildShareSize, codeAlphabet))
			}
		case b.has("name") || b.has("plan"):
			if b.has("name") {
				name, err := buildName(b["name"])
				if err != nil {
					return nil, err
				}
				r.Set("name", name)
			}
			if b.has("plan") {
				plan, err := readPlan(b["plan"])
				if err != nil {
					return nil, err
				}
				r.Set("plan", plan)
			}
		default:
			return nil, badRequest("Send a new name or plan, share (true or false) or remove: true.")
		}
		if err := app.Save(r); err != nil {
			return nil, err
		}
		return map[string]any{"build": buildJSON(r, false)}, nil
	})
}

// roomForBuild says whether the account may keep another build.
func roomForBuild(app core.App, userId string) error {
	n, err := app.CountRecords("builds", dbx.HashExp{"user": userId})
	if err != nil {
		return err
	}
	if n >= buildLimit {
		return badRequest("You can keep up to 50 builds. Delete one first.")
	}
	return nil
}

func saveBuild(app core.App, userId, name, class string, plan buildPlan) (any, error) {
	if err := roomForBuild(app, userId); err != nil {
		return nil, err
	}
	r, err := newRecord(app, "builds")
	if err != nil {
		return nil, err
	}
	r.Set("user", userId)
	r.Set("name", name)
	r.Set("class", class)
	r.Set("plan", plan)
	if err := app.Save(r); err != nil {
		return nil, err
	}
	return map[string]any{"build": buildJSON(r, false)}, nil
}

func newBuild(app core.App, userId string, b body) (any, error) {
	name, err := buildName(b["name"])
	if err != nil {
		return nil, err
	}
	class, err := buildClass(b["class"])
	if err != nil {
		return nil, err
	}
	plan := buildPlan{Gear: []buildGear{}, Skills: []buildSkill{}, Boards: []buildBoard{}}
	if b.has("plan") {
		if plan, err = readPlan(b["plan"]); err != nil {
			return nil, err
		}
	}
	return saveBuild(app, userId, name, class, plan)
}

// copyBuild keeps a copy of a shared build as the account's own, private, under its name or the one sent.
func copyBuild(app core.App, userId string, b body) (any, error) {
	code := b.str("copy")
	var shared *core.Record
	if buildShareCode.MatchString(code) {
		shared, _ = app.FindFirstRecordByFilter("builds", "share = {:code}", dbx.Params{"code": code})
	}
	if shared == nil {
		return nil, notFound("This build is not shared any more.")
	}
	name := shared.GetString("name")
	if b.has("name") {
		var err error
		if name, err = buildName(b["name"]); err != nil {
			return nil, err
		}
	}
	return saveBuild(app, userId, name, shared.GetString("class"), planOf(shared))
}

// buildsExport is the account's builds for the data download: each with its plan and whether it
// is shared, without its link's code.
func buildsExport(app core.App, userId string) ([]any, error) {
	found, err := app.FindRecordsByFilter("builds", "user = {:user}", "created", 0, 0, dbx.Params{"user": userId})
	if err != nil {
		return nil, err
	}
	out := make([]any, len(found))
	for i, r := range found {
		out[i] = map[string]any{"name": r.GetString("name"), "class": r.GetString("class"), "plan": planOf(r), "shared": r.GetString("share") != "",
			"created": r.GetString("created"), "updated": r.GetString("updated")}
	}
	return out, nil
}
