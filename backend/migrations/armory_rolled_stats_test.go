package migrations

import (
	"encoding/json"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The builds kept before 0.64.0 take their items' rolled stats from the profiles they were taken
// from: the same slot and name, from a profile read with the build or later, never over rolled
// stats they have. A build without a kept profile, or with an older one, stays as it was.
func TestArmoryBuildsTakeRolledStatsFromTheirProfiles(t *testing.T) {
	app := newMigratedApp(t)
	at := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	stamp := func(d time.Duration) string { return at.Add(d).Format("2006-01-02 15:04:05.000Z") }
	save := func(name string, values m) *core.Record {
		t.Helper()
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		r := core.NewRecord(c)
		for k, v := range values {
			r.Set(k, v)
		}
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	rolled := []any{m{"name": "Combat Speed", "value": "13%"}, m{"name": "Critical Hit", "value": "120", "min": "100"}}
	profile := m{"v": 2, "name": "Ka", "gear": []any{
		m{"slot": "MainHand", "name": "Rod", "detail": m{"itemLevel": 102, "sub": rolled}},
		m{"slot": "Helmet", "name": "New Helm", "detail": m{"sub": rolled}},
		m{"slot": "Gloves", "name": "Gloves", "detail": m{"sub": []any{m{"name": "Accuracy", "value": "50"}}}},
	}}
	build := m{"v": 2, "name": "Ka", "gear": []any{
		m{"slot": "MainHand", "name": "Rod", "grade": "Unique", "detail": m{"itemLevel": 102, "sub": []any{}, "stones": []any{m{"name": "Attack"}}}},
		m{"slot": "Helmet", "name": "Old Helm", "detail": m{"sub": []any{}}},
		m{"slot": "Gloves", "name": "Gloves", "detail": m{"sub": []any{m{"name": "Evasion", "value": "40"}}}},
		m{"slot": "Pet", "name": "Pagati"},
	}}
	rank := func(n string, builtAt string) *core.Record {
		return save("armory_ranks", m{"region": "eu", "serverId": 2304, "characterId": n, "name": "Ka", "class": "Chanter", "combatPower": 1000, "build": build, "builtAt": builtAt})
	}
	kept := func(n, fetchedAt string) {
		save("armory_profiles", m{"region": "eu", "serverId": 2304, "characterId": n, "name": "Ka", "profile": profile, "fetchedAt": fetchedAt})
	}
	// Read with the build (a moment before it), read before it, and no profile kept.
	withBuild, older, alone := rank("A", stamp(time.Second)), rank("B", stamp(time.Hour)), rank("C", stamp(0))
	kept("A", stamp(0))
	kept("B", stamp(0))
	if err := armoryRolledStatsUp(app); err != nil {
		t.Fatal(err)
	}
	gear := func(r *core.Record) []any {
		t.Helper()
		fresh, err := app.FindRecordById("armory_ranks", r.Id)
		if err != nil {
			t.Fatal(err)
		}
		var b m
		if err := json.Unmarshal([]byte(fresh.GetString("build")), &b); err != nil {
			t.Fatal(err)
		}
		return b["gear"].([]any)
	}
	sub := func(item any) string {
		raw, _ := json.Marshal(item.(m)["detail"].(m)["sub"])
		return string(raw)
	}
	g := gear(withBuild)
	if got := sub(g[0]); got != `[{"name":"Combat Speed","value":"13%"},{"name":"Critical Hit","value":"120"}]` {
		t.Fatalf("main hand's rolled stats: %s", got)
	}
	if g[0].(m)["grade"] != "Unique" || len(g[0].(m)["detail"].(m)["stones"].([]any)) != 1 || len(g) != 4 {
		t.Fatalf("the rest of the build changed: %v", g)
	}
	if sub(g[1]) != `[]` || sub(g[2]) != `[{"name":"Evasion","value":"40"}]` {
		t.Fatalf("another item's or kept rolled stats taken: %s, %s", sub(g[1]), sub(g[2]))
	}
	for _, r := range []*core.Record{older, alone} {
		if got := sub(gear(r)[0]); got != `[]` {
			t.Fatalf("%s took rolled stats: %s", r.GetString("characterId"), got)
		}
	}
	// Run again, nothing changes.
	if err := armoryRolledStatsUp(app); err != nil {
		t.Fatal(err)
	}
	if got := sub(gear(withBuild)[0]); got != `[{"name":"Combat Speed","value":"13%"},{"name":"Critical Hit","value":"120"}]` {
		t.Fatalf("again: %s", got)
	}
}
