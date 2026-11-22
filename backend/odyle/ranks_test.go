package odyle

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
)

// rankRow is a character's row among the top players, as the tests read it.
type rankRow struct {
	Name        string `db:"name"`
	Class       string `db:"class"`
	CombatPower int64  `db:"combatPower"`
	Portrait    string `db:"portrait"`
	Build       string `db:"build"`
	BuiltAt     string `db:"builtAt"`
	Hidden      bool   `db:"hidden"`
}

func rankAt(t *testing.T, app interface {
	DB() dbx.Builder
}, characterId string) (rankRow, bool) {
	t.Helper()
	var row rankRow
	err := app.DB().NewQuery("SELECT name, class, combatPower, portrait, COALESCE(CAST(build AS TEXT), '') AS build, builtAt, hidden FROM armory_ranks WHERE characterId = {:id}").Bind(dbx.Params{"id": characterId}).One(&row)
	if isNoRows(err) {
		return row, false
	}
	if err != nil {
		t.Fatal(err)
	}
	return row, true
}

// A lookup keeps the character among the top players with its build: the gear as the Upgrade tab
// compares it, rolled stats included, without what it does not read; a character PLAYNC no longer lists leaves them, and
// hiding its profile hides it there too.
func TestArmoryLookupsKeepTheTopPlayers(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	stateOf(app).armory.wait()
	row, ok := rankAt(t, app, id)
	if !ok || row.Name != "Hero" || row.Class != "Chanter" || row.CombatPower != 107458 || !strings.HasPrefix(row.Portrait, "portrait-") || row.BuiltAt == "" || row.Hidden {
		t.Fatalf("rank %+v", row)
	}
	var build armoryProfile
	if err := json.Unmarshal([]byte(row.Build), &build); err != nil {
		t.Fatal(err)
	}
	main := build.Gear[0].Detail
	if build.Gear[0].Slot != "MainHand" || main == nil || main.ItemLevel != 102 || len(main.Stones) != 1 || main.Stones[0] != (armoryStone{Name: "Attack"}) || len(main.Main) != 0 || main.Set.Name != "Primal Vigor" || len(main.Set.Bonuses) != 0 ||
		len(main.Sub) != 2 || main.Sub[0] != (armoryLine{Name: "Combat Speed", Value: "13%"}) || main.Sub[1] != (armoryLine{Name: "Might", Value: "32"}) ||
		len(build.Stats) != 0 || len(build.Skills) != 1 || build.Skills[0].Name != "Earth's Retribution" || len(build.Boards) != 2 || len(build.Boards[0].Nodes) != 0 || build.Boards[0].Open != 12 || build.Portrait != "" {
		t.Fatalf("build %s", row.Build)
	}
	if len(row.Build) > 4000 {
		t.Fatalf("a build of %d bytes", len(row.Build))
	}
	// Hidden with its profile.
	profile, err := keptProfile(app, 2304, id)
	if err != nil {
		t.Fatal(err)
	}
	profile.Set("hidden", true)
	if err := app.Save(profile); err != nil {
		t.Fatal(err)
	}
	if row, _ := rankAt(t, app, id); !row.Hidden {
		t.Fatal("the rank stays shown")
	}
	// A character PLAYNC does not list leaves the top players.
	rankOf(t, app, 1, "Chanter", 1000, false, map[string]any{"characterId": "missingAAAAAAAAAAAAAAAA"})
	ask(t, app, "GET", armoryPath("missingAAAAAAAAAAAAAAAA"), nil, "", 200)
	stateOf(app).armory.wait()
	if _, ok := rankAt(t, app, "missingAAAAAAAAAAAAAAAA"); ok {
		t.Fatal("a character PLAYNC does not list stays ranked")
	}
}

// The top players page lists the classes in their class ids' order with how many characters of
// each the armory knows, and the strongest of the class asked for, hidden ones left out.
func TestTopPlayersByClass(t *testing.T) {
	app := newTestApp(t)
	rankOf(t, app, 1, "Chanter", 100000, true, map[string]any{"portrait": "portrait-a.jpg"})
	rankOf(t, app, 2, "Chanter", 300000, false, map[string]any{"serverId": 1101, "region": "nae"})
	rankOf(t, app, 3, "Chanter", 900000, false, map[string]any{"hidden": true})
	rankOf(t, app, 4, "Cleric", 200000, false, nil)
	top := ask(t, app, "GET", "/api/odyle/armory/top?class=Chanter", nil, "", 200)
	// The classes the Global pages named on 2026-10-16 are built in (classes.go).
	classes := []string{}
	for _, c := range top["classes"].([]any) {
		classes = append(classes, fmt.Sprintf("%s %v", c.(map[string]any)["name"], c.(map[string]any)["characters"]))
	}
	if strings.Join(classes, ",") != "Gladiator 0,Templar 0,Ranger 0,Assassin 0,Spiritmaster 0,Sorcerer 0,Cleric 1,Chanter 2" || top["class"] != "Chanter" || top["characters"].(float64) != 2 {
		t.Fatalf("classes %v, %v", classes, top)
	}
	players := top["players"].([]any)
	first, second := players[0].(map[string]any), players[1].(map[string]any)
	if len(players) != 2 || first["place"].(float64) != 1 || first["name"] != "Hero2" || first["server"] != "Siel" || first["region"] != "nae" || first["built"] != false ||
		second["name"] != "Hero1" || second["portrait"] != "portrait-a.jpg" || second["built"] != true || !strings.HasSuffix(second["checkedAt"].(string), "Z") {
		t.Fatalf("players %v", players)
	}
	// Without a class, the first; a class the armory does not know is no page.
	if first := ask(t, app, "GET", "/api/odyle/armory/top", nil, "", 200); first["class"] != "Gladiator" || len(first["players"].([]any)) != 0 {
		t.Fatalf("first class %v", first)
	}
	ask(t, app, "GET", "/api/odyle/armory/top?class=Nobody", nil, "", 404)
}

// The nightly clean-up forgets the characters checked more than 30 days ago that are not in their
// class's top, and keeps the top and hidden ones.
func TestTopPlayersBelowTheTopAreForgotten(t *testing.T) {
	app := newTestApp(t)
	old := ago(rankKeep + time.Hour)
	if _, err := app.DB().NewQuery(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {:count})
		INSERT INTO armory_ranks (id, region, serverId, characterId, class, combatPower, checkedAt, hidden) SELECT printf('rank%011d', i), 'eu', 2304, printf('AAAAAAAAAAAAAA%010d', i), 'Chanter', i, {:old}, i = 2 FROM n`).
		Bind(dbx.Params{"count": rankLimit + 3, "old": old}).Execute(); err != nil {
		t.Fatal(err)
	}
	rankOf(t, app, 1, "Chanter", 1, false, nil) // checked now, the weakest
	n, err := cleanRanks(app)
	if err != nil || n != 2 {
		t.Fatalf("forgot %d (%v)", n, err)
	}
	var weakest int64
	if err := app.DB().NewQuery("SELECT MIN(combatPower) FROM armory_ranks WHERE hidden = FALSE AND checkedAt < {:old}").Bind(dbx.Params{"old": ago(rankKeep)}).Row(&weakest); err != nil || weakest != 4 {
		t.Fatalf("the weakest old one left has %d (%v)", weakest, err)
	}
	if countOf(t, app, "armory_ranks") != int64(rankLimit+2) {
		t.Fatalf("%d left", countOf(t, app, "armory_ranks"))
	}
}
