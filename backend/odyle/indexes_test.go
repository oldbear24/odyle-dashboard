package odyle

import (
	"errors"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/inflector"
)

// queryPlan is SQLite's query plan of the query, with {:value} bound to "x".
func queryPlan(t *testing.T, app core.App, query string) string {
	t.Helper()
	var steps []struct {
		Detail string `db:"detail"`
	}
	if err := app.DB().NewQuery("EXPLAIN QUERY PLAN " + query).Bind(dbx.Params{"value": "x"}).All(&steps); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	details := []string{}
	for _, s := range steps {
		details = append(details, s.Detail)
	}
	return strings.Join(details, "; ")
}

func usesAnIndex(plan string) bool {
	return strings.Contains(plan, "USING INDEX") || strings.Contains(plan, "USING COVERING INDEX")
}

// The lookups of the calendar feed, the data export, the achievements and account deletion
// use an index instead of reading the whole table.
func TestLookupsUseAnIndex(t *testing.T) {
	app := newTestApp(t)
	for name, query := range map[string]string{
		"calendar feed":   "SELECT id FROM users WHERE calendarDigest = {:value} LIMIT 1",
		"rooms owned":     "SELECT id FROM party_rooms WHERE owner = {:value}",
		"links made":      "SELECT id FROM room_invites WHERE createdBy = {:value}",
		"links made used": "SELECT COALESCE(SUM(uses), 0) FROM room_invites WHERE createdBy = {:value}",
		"room's posts":    "SELECT id FROM discord_posts WHERE room = {:value}",
		"history gone":    "DELETE FROM character_readings WHERE character = {:value}",
		"places gone":     "DELETE FROM character_locations WHERE character = {:value}",
		"fights gone":     "DELETE FROM character_pvp WHERE character = {:value}",
	} {
		if got := queryPlan(t, app, query); !usesAnIndex(got) {
			t.Errorf("%s reads %q", name, got)
		}
	}
}

// Deleting a record makes PocketBase look up, for every relation that points at its collection
// and deletes with it, the records that point at it (core.cascadeRecordDelete). Each of those
// lookups uses an index: deleting a character, a room or an account reads no whole table.
func TestCascadesUseAnIndex(t *testing.T) {
	app := newTestApp(t)
	collections, err := app.FindAllCollections(core.CollectionTypeBase, core.CollectionTypeAuth)
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, c := range collections {
		for _, f := range c.Fields {
			relation, ok := f.(*core.RelationField)
			if !ok || !relation.CascadeDelete || relation.IsMultiple() {
				continue
			}
			table := inflector.Columnify(c.Name)
			query := "SELECT " + table + ".id FROM " + table + " WHERE " + table + "." + inflector.Columnify(relation.Name) + " = {:value} LIMIT 8000"
			if got := queryPlan(t, app, query); !usesAnIndex(got) {
				t.Errorf("deleting what %s.%s points at reads %q", c.Name, relation.Name, got)
			}
			checked++
		}
	}
	if checked < 20 {
		t.Fatalf("only %d cascades checked", checked)
	}
}

// Deleting a character deletes its history, places and PvP events in bulk, also when the account
// goes with its characters; another character's rows stay, and a deletion that fails keeps them.
func TestCharacterHistoryGoesInBulk(t *testing.T) {
	app := newTestApp(t)
	user, other := newUser(t, app, "Leaving"), newUser(t, app, "Staying")
	withRows := func(owner *core.Record, name string) *core.Record {
		c := saved(t, app, "characters", map[string]any{"user": owner.Id, "characterName": name, "server": "Lumiel", "region": "GLOBAL_EU"})
		for i := range 3 {
			saved(t, app, "character_readings", map[string]any{"character": c.Id, "value": i})
			saved(t, app, "character_locations", map[string]any{"character": c.Id, "map": 1})
			saved(t, app, "character_pvp", map[string]any{"character": c.Id, "event": "e" + string(rune('0'+i)), "kind": "kill", "name": "Foe", "at": "2026-11-20 10:00:00.000Z"})
		}
		saved(t, app, "user_tasks", map[string]any{"user": owner.Id, "character": c.Id, "title": "Daily", "cadence": "daily"})
		return c
	}
	rows := func(c *core.Record) int {
		total := 0
		for _, table := range append([]string{"user_tasks"}, historyTables...) {
			n, err := app.CountRecords(table, dbx.HashExp{"character": c.Id})
			if err != nil {
				t.Fatal(err)
			}
			total += int(n)
		}
		return total
	}
	first, second, kept := withRows(user, "First"), withRows(user, "Second"), withRows(other, "Kept")
	// None of them is deleted one record at a time.
	one := 0
	app.OnRecordDelete(historyTables...).BindFunc(func(e *core.RecordEvent) error {
		one++
		return e.Next()
	})

	// A deletion that fails after the history went keeps it: the bulk delete is in its transaction.
	failing := app.OnRecordDeleteExecute("characters").Bind(&hook.Handler[*core.RecordEvent]{
		Func:     func(e *core.RecordEvent) error { return errors.New("refused") },
		Priority: 101,
	})
	if err := app.Delete(first); err == nil {
		t.Fatal("the failing deletion went through")
	}
	if got := rows(first); got != 10 {
		t.Fatalf("a failed deletion left %d of 10 rows", got)
	}
	app.OnRecordDeleteExecute("characters").Unbind(failing)

	if err := app.Delete(first); err != nil {
		t.Fatal(err)
	}
	if got := rows(first); got != 0 {
		t.Fatalf("%d rows of a deleted character stay", got)
	}
	if err := app.Delete(user); err != nil {
		t.Fatal(err)
	}
	if got := rows(second); got != 0 {
		t.Fatalf("%d rows of a deleted account's character stay", got)
	}
	if got := rows(kept); got != 10 {
		t.Fatalf("another character keeps %d of 10 rows", got)
	}
	if one != 0 {
		t.Fatalf("%d rows deleted one at a time", one)
	}
}
