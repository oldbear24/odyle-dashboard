package odyle

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The top of each class read from the index is the top inTop numbers: ties at the last place
// broken by id, hidden rows and rows without a class left out, small classes whole; and it is
// read from the index alone.
func TestTopRowsAreTheTopOfEachClass(t *testing.T) {
	app := newTestApp(t)
	err := app.RunInTransaction(func(tx core.App) error {
		for n := range 2600 {
			class := []string{"Chanter", "Cleric", "Templar", ""}[n%4]
			if n%4 == 2 && n > 400 {
				continue // a class smaller than the top
			}
			power := 900000 - (n/7)*13 // runs of equal combat power
			built := ""
			if n%3 == 0 {
				built = stamp(time.Now().AddDate(0, 0, -n%40))
			}
			if _, err := tx.DB().NewQuery("INSERT INTO armory_ranks (id, region, serverId, characterId, name, class, combatPower, builtAt, hidden) VALUES ({:id}, 'eu', 2304, {:cid}, 'Hero', {:class}, {:power}, {:built}, {:hidden})").
				Bind(dbx.Params{"id": fmt.Sprintf("r%014d", (n*7919)%100003), "cid": fmt.Sprint("C", n), "class": class, "power": power, "built": built, "hidden": n%11 == 0}).Execute(); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{}
	if err := app.DB().NewQuery("SELECT id FROM armory_ranks WHERE id IN (" + inTop + ") ORDER BY combatPower DESC, id").Bind(dbx.Params{"limit": rankLimit}).Column(&want); err != nil {
		t.Fatal(err)
	}
	rows, err := topRows(app, rankLimit)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, r := range rows {
		got = append(got, r.Id)
	}
	if len(want) <= 2*rankLimit {
		t.Fatalf("the window found %d", len(want))
	}
	if !slices.Equal(got, want) {
		t.Fatalf("top rows differ: %d rows, want %d", len(got), len(want))
	}
	old := stamp(time.Now().AddDate(0, 0, -20))
	pendingWant := []string{}
	if err := app.DB().NewQuery("SELECT id FROM armory_ranks WHERE id IN (" + inTop + ") AND (builtAt = '' OR builtAt < {:old}) ORDER BY combatPower DESC, id").Bind(dbx.Params{"limit": rankLimit, "old": old}).Column(&pendingWant); err != nil {
		t.Fatal(err)
	}
	pending, err := pendingBuilds(app, old)
	if err != nil {
		t.Fatal(err)
	}
	pendingGot := []string{}
	for _, r := range pending {
		pendingGot = append(pendingGot, r.Id)
	}
	if !slices.Equal(pendingGot, pendingWant) {
		t.Fatalf("pending builds differ: %d, want %d", len(pendingGot), len(pendingWant))
	}
	// From the index alone.
	plan := []struct {
		Detail string `db:"detail"`
	}{}
	if err := app.DB().NewQuery("EXPLAIN QUERY PLAN SELECT id, combatPower, builtAt, checkedAt FROM armory_ranks WHERE class = {:class} AND hidden = FALSE ORDER BY combatPower DESC, id LIMIT {:limit}").Bind(dbx.Params{"class": "Chanter", "limit": rankLimit}).All(&plan); err != nil {
		t.Fatal(err)
	}
	if len(plan) != 1 || !strings.Contains(plan[0].Detail, "COVERING INDEX idx_armory_ranks_top") {
		t.Fatalf("plan %+v", plan)
	}
}

// A kept profile goes out as kept, and one naming an image the server no longer keeps is fetched
// again once a reader's Refresh would count, not before.
func TestKeptProfilesGoOutAsKept(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	profile := func(id, raw string, fetched time.Duration) {
		t.Helper()
		kept := saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": id, "name": "Kept", "fetchedAt": ago(fetched), "viewedAt": now()})
		if _, err := app.DB().NewQuery("UPDATE armory_profiles SET profile = {:p} WHERE id = {:id}").Bind(dbx.Params{"p": raw, "id": kept.Id}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	const gone = `{"v":2,"name":"Kept","class":"Chanter","combatPower":12345678901,"gear":[{"slot":"MainHand","name":"<Rod>","icon":"gone_icon.png"}]}`
	profile("goneAAAAAAAAAAAAAAAAAAA1", gone, 20*time.Minute)
	profile("goneAAAAAAAAAAAAAAAAAAA2", gone, 5*time.Minute)
	profile("keptAAAAAAAAAAAAAAAAAAA3", `{"v":2,"name":"Kept","class":"Chanter","gear":[]}`, 20*time.Minute)
	profile("oldAAAAAAAAAAAAAAAAAAAA4", `{"v":1,"name":"Old"}`, time.Minute)
	for id, state := range map[string]string{"goneAAAAAAAAAAAAAAAAAAA1": "paused", "goneAAAAAAAAAAAAAAAAAAA2": "fresh", "keptAAAAAAAAAAAAAAAAAAA3": "fresh", "oldAAAAAAAAAAAAAAAAAAAA4": "paused"} {
		got := ask(t, app, "GET", armoryPath(id), nil, "", 200)
		if got["state"] != state {
			t.Errorf("%s: state %v, want %s", id, got["state"], state)
		}
	}
	got := ask(t, app, "GET", armoryPath("goneAAAAAAAAAAAAAAAAAAA2"), nil, "", 200)
	p, _ := got["profile"].(map[string]any)
	gear, _ := p["gear"].([]any)
	if p["combatPower"] != 12345678901.0 || len(gear) != 1 || gear[0].(map[string]any)["name"] != "<Rod>" || p["class"] != "Chanter" || got["partial"] != false {
		t.Fatalf("profile %v", got)
	}
}
