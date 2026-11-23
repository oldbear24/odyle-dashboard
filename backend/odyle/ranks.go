package odyle

import (
	"cmp"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory's top players by class (/armory/top/<class>, src/armory.js armoryTop) and the
// characters the Upgrade tab compares with (upgrades.go). PLAYNC's Global pages list no rankings
// (docs/armory.md), so armory_ranks keeps every character the armory knows the combat power of:
// each profile a reader opens keeps its row up to date, gear included (keepRank), and the scout
// (scout.go) adds the characters it finds with PLAYNC's character search, reading the gear of those
// that make their class's top. Nothing in it is typed in by players (R1).

const (
	rankLimit = 500                 // the top players listed of each class, and what the Upgrade tab compares with
	rankKeep  = 30 * 24 * time.Hour // a character below its class's top, checked this long ago, is forgotten
)

// slimmed is a copy of the profile with only what the Upgrade tab compares (its build): each
// item's slot, name, grade, enchantment, exceed level, icon, type, item level and limits, main
// stats and rolled stats (soul binding) by name and value, stones by name and grade, stone slots,
// set (with its bonuses on the first of its pieces) and where it comes from; the Daevanion boards'
// open nodes; the skills on the skill bar. Some 12 KB for a character at the level cap.
func slimmed(p armoryProfile) armoryProfile {
	var out armoryProfile
	if raw, err := json.Marshal(p); err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	out.slim()
	return out
}

// slim leaves out of a profile what the comparison does not read.
func (p *armoryProfile) slim() {
	p.Stats, p.Skins, p.Titles, p.Portrait, p.Title, p.TitleGrade, p.Legion = []armoryStat{}, []armorySkin{}, armoryTitles{Equipped: []armoryTitle{}}, "", "", "", ""
	for i := range p.Boards {
		p.Boards[i].Icon, p.Boards[i].Nodes, p.Boards[i].StatEffects, p.Boards[i].SkillEffects = "", []armoryNode{}, []string{}, []string{}
	}
	sets := map[string]bool{} // the sets whose bonuses an earlier piece keeps
	for i := range p.Gear {
		d := p.Gear[i].Detail
		if d == nil {
			continue
		}
		rolled := make([]armoryLine, 0, len(d.Sub))
		for _, line := range d.Sub {
			rolled = append(rolled, armoryLine{Name: line.Name, Value: line.Value})
		}
		main := make([]armoryLine, 0, len(d.Main))
		for _, line := range d.Main {
			main = append(main, armoryLine{Name: line.Name, Value: line.Value, Extra: line.Extra, Exceed: line.Exceed})
		}
		d.Main, d.Sub, d.SubSkills, d.GodStones, d.Skins, d.Classes, d.Desc, d.Race = main, rolled, []armorySubSkill{}, []armoryStone{}, []string{}, []string{}, "", ""
		for j := range d.Stones {
			d.Stones[j] = armoryStone{Name: d.Stones[j].Name, Grade: d.Stones[j].Grade}
		}
		if d.Set != nil {
			bonuses := []armorySetBonus{}
			if !sets[d.Set.Name] && d.Set.Bonuses != nil {
				sets[d.Set.Name], bonuses = true, d.Set.Bonuses
			}
			d.Set = &armorySet{Name: d.Set.Name, Equipped: d.Set.Equipped, Items: []armorySetItem{}, Bonuses: bonuses}
		}
	}
	skills := []armorySkill{}
	for _, s := range p.Skills {
		if s.Equipped {
			skills = append(skills, armorySkill{Name: s.Name, Category: s.Category, Level: s.Level, Acquired: s.Acquired, Equipped: true, Icon: s.Icon})
		}
	}
	p.Skills = skills
}

// keepRank keeps a character's row as PLAYNC's pages list it now: its name, class, level, combat
// power and item level, and with built (its gear was read too) its build and portrait. A hidden
// row keeps its switch.
func keepRank(app core.App, region string, serverId int, characterId string, p armoryProfile, built bool) error {
	record, err := app.FindFirstRecordByFilter("armory_ranks", "serverId = {:server} && characterId = {:id}", dbx.Params{"server": serverId, "id": characterId})
	if isNoRows(err) {
		collection, findErr := app.FindCachedCollectionByNameOrId("armory_ranks")
		if findErr != nil {
			return findErr
		}
		record, err = core.NewRecord(collection), nil
		record.Set("serverId", serverId)
		record.Set("characterId", characterId)
		// A character whose profile is hidden stays out of the top players too.
		if hidden, _ := app.CountRecords("armory_profiles", dbx.HashExp{"serverId": serverId, "characterId": characterId, "hidden": true}); hidden > 0 {
			record.Set("hidden", true)
		}
	}
	if err != nil {
		return err
	}
	record.Set("region", region)
	record.Set("name", cut(p.Name, 40))
	record.Set("class", cut(p.Class, 40))
	record.Set("level", p.Level)
	record.Set("combatPower", p.CombatPower)
	record.Set("itemLevel", p.ItemLevel)
	record.Set("checkedAt", now())
	if built {
		// The scout keeps no portraits: a reader's lookup keeps one.
		if p.Portrait != "" {
			record.Set("portrait", p.Portrait)
		}
		record.Set("build", slimmed(p))
		// A build read with some details missing is due again a day later, not after
		// scoutRebuild: it counts as read that much earlier.
		builtAt := time.Now()
		if p.Missing > 0 {
			builtAt = builtAt.Add(24*time.Hour - scoutRebuild)
		}
		record.Set("builtAt", iso(builtAt))
	}
	return app.Save(record)
}

// forgetRank deletes a character's row (PLAYNC no longer lists it), unless it is hidden.
func forgetRank(app core.App, serverId int, characterId string) error {
	_, err := app.DB().NewQuery("DELETE FROM armory_ranks WHERE serverId = {:server} AND characterId = {:id} AND hidden = FALSE").Bind(dbx.Params{"server": serverId, "id": characterId}).Execute()
	return err
}

// watchArmoryProfiles hides a character's row with its profile: a superuser hiding a profile
// keeps the character out of the top players and the scout too.
func watchArmoryProfiles(app core.App) {
	hide := func(e *core.RecordEvent) error {
		if e.Record.GetBool("hidden") {
			if _, err := e.App.DB().NewQuery("UPDATE armory_ranks SET hidden = TRUE WHERE serverId = {:server} AND characterId = {:id}").
				Bind(dbx.Params{"server": e.Record.GetInt("serverId"), "id": e.Record.GetString("characterId")}).Execute(); err != nil {
				return err
			}
		}
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("armory_profiles").BindFunc(hide)
	app.OnRecordAfterUpdateSuccess("armory_profiles").BindFunc(hide)
}

// inTop is the SQL of the ids of the rows within their class's top rankLimit.
const inTop = "SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY class ORDER BY combatPower DESC, id) AS place FROM armory_ranks WHERE hidden = FALSE AND class != '') WHERE place <= {:limit}"

// topRow is a row within its class's top: its id, combat power and when its gear was read.
type topRow struct {
	Id          string `db:"id"`
	CombatPower int64  `db:"combatPower"`
	BuiltAt     string `db:"builtAt"`
}

// rankedClasses is the SQL of the classes of the rows shown (not empty), one index seek each.
const rankedClasses = "WITH RECURSIVE c(class) AS (SELECT (SELECT MIN(class) FROM armory_ranks WHERE hidden = FALSE AND class > '') " +
	"UNION ALL SELECT (SELECT MIN(class) FROM armory_ranks WHERE hidden = FALSE AND class > c.class) FROM c WHERE c.class IS NOT NULL) SELECT class FROM c WHERE class IS NOT NULL"

// topRows are the rows within their class's top rankLimit (the rows of inTop), the strongest
// first as "ORDER BY combatPower DESC, id" orders them: read class by class from the top players
// index (idx_armory_ranks_top) alone, instead of numbering every row of the table.
func topRows(app core.App) ([]topRow, error) {
	classes := []string{}
	if err := app.DB().NewQuery(rankedClasses).Column(&classes); err != nil {
		return nil, err
	}
	rows := []topRow{}
	for _, class := range classes {
		top := []topRow{}
		if err := app.DB().NewQuery("SELECT id, combatPower, builtAt FROM armory_ranks WHERE class = {:class} AND hidden = FALSE ORDER BY combatPower DESC, id LIMIT {:limit}").
			Bind(dbx.Params{"class": class, "limit": rankLimit}).All(&top); err != nil {
			return nil, err
		}
		rows = append(rows, top...)
	}
	slices.SortFunc(rows, func(a, b topRow) int {
		return cmp.Or(cmp.Compare(b.CombatPower, a.CombatPower), strings.Compare(a.Id, b.Id))
	})
	return rows, nil
}

// topIds are the rows' ids, for dbx.In.
func topIds(rows []topRow) []any {
	ids := make([]any, len(rows))
	for i, r := range rows {
		ids[i] = r.Id
	}
	return ids
}

// cleanRanks forgets the characters checked more than rankKeep ago that are not in their class's
// top, so the scout may find them again; hidden ones are kept.
func cleanRanks(app core.App) (int, error) {
	res, err := app.DB().NewQuery("DELETE FROM armory_ranks WHERE hidden = FALSE AND checkedAt < {:before} AND id NOT IN (" + inTop + ")").
		Bind(dbx.Params{"before": ago(rankKeep), "limit": rankLimit}).Execute()
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// rankClass is a class on the top players page: its name, emblem and how many characters of it
// the armory knows.
type rankClass struct {
	Name       string `json:"name"`
	Icon       string `json:"icon"`
	Characters int    `json:"characters"`
}

// rankClasses are the classes PLAYNC's pages named (classes.go), in their class ids' order.
func rankClasses(app core.App) ([]rankClass, error) {
	out := []rankClass{}
	if err := app.DB().NewQuery("SELECT name, MAX(icon) AS icon FROM game_classes WHERE name != '' GROUP BY name ORDER BY MIN(pcId)").All(&out); err != nil {
		return nil, err
	}
	counts := []struct {
		Class string `db:"class"`
		N     int    `db:"n"`
	}{}
	if err := app.DB().NewQuery("SELECT class, COUNT(*) AS n FROM armory_ranks WHERE hidden = FALSE GROUP BY class").All(&counts); err != nil {
		return nil, err
	}
	for i := range out {
		for _, c := range counts {
			if c.Class == out[i].Name {
				out[i].Characters = c.N
			}
		}
	}
	return out, nil
}

// rankPlayer is a character on the top players page.
type rankPlayer struct {
	Place       int    `db:"-" json:"place"`
	Name        string `db:"name" json:"name"`
	Level       int64  `db:"level" json:"level"`
	Server      string `db:"-" json:"server"`
	Region      string `db:"region" json:"region"`
	ServerId    int    `db:"serverId" json:"serverId"`
	CharacterId string `db:"characterId" json:"characterId"`
	CombatPower int64  `db:"combatPower" json:"combatPower"`
	ItemLevel   int64  `db:"itemLevel" json:"itemLevel"`
	Portrait    string `db:"portrait" json:"portrait"`
	CheckedAt   string `db:"checkedAt" json:"checkedAt"`
	Built       bool   `db:"built" json:"built"`
}

// topRoute answers GET /api/odyle/armory/top?class=: the classes, and the strongest rankLimit
// characters the armory knows of the class asked for (the first class when none is). Public;
// rate limited per address with the armory.
func topRoute(e *core.RequestEvent) error {
	classes, err := rankClasses(e.App)
	if err != nil {
		return err
	}
	class, known := e.Request.URL.Query().Get("class"), false
	if class == "" && len(classes) > 0 {
		class = classes[0].Name
	}
	characters := 0
	for _, c := range classes {
		if c.Name == class {
			known, characters = true, c.Characters
		}
	}
	if class != "" && !known {
		return notFound("The armory keeps no character of that class.")
	}
	players := []rankPlayer{}
	if err := e.App.DB().NewQuery("SELECT region, serverId, characterId, name, level, combatPower, itemLevel, portrait, checkedAt, builtAt != '' AS built FROM armory_ranks WHERE class = {:class} AND hidden = FALSE ORDER BY combatPower DESC, id LIMIT {:limit}").
		Bind(dbx.Params{"class": class, "limit": rankLimit}).All(&players); err != nil {
		return err
	}
	book := serversOf(e.App)
	for i := range players {
		p := &players[i]
		p.Place, p.Server = i+1, book.name(p.ServerId)
		if at, err := time.Parse(stampLayout, p.CheckedAt); err == nil {
			p.CheckedAt = isoTime(at)
		}
	}
	e.Response.Header().Set("Cache-Control", "public, max-age=60")
	return e.JSON(200, map[string]any{"class": class, "classes": classes, "characters": characters, "players": players})
}
