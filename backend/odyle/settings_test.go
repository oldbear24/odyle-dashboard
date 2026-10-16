package odyle

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestCachedSettingsFollowEveryChange(t *testing.T) {
	app := newTestApp(t)
	perCube := func() int64 { return readSettings(app).OdylePerCube }
	if got := perCube(); got != 40 {
		t.Fatalf("default Odyle per cube is %d", got)
	}
	// The Game settings page.
	if _, err := writeSettings(app, body{"odylePerCube": float64(55)}); err != nil {
		t.Fatal(err)
	}
	if got := perCube(); got != 55 {
		t.Fatalf("after saving the settings: %d", got)
	}
	// A superuser editing the record under Collections → odyle_settings.
	record := findSettings(app)
	record.Set("odylePerCube", 60)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if got := perCube(); got != 60 {
		t.Fatalf("after editing the record: %d", got)
	}
	// A change inside a transaction counts once it commits.
	if err := app.RunInTransaction(func(tx core.App) error {
		r := findSettings(tx)
		r.Set("odylePerCube", 70)
		return tx.Save(r)
	}); err != nil {
		t.Fatal(err)
	}
	if got := perCube(); got != 70 {
		t.Fatalf("after a committed transaction: %d", got)
	}
	// A rolled back change is forgotten, even when an empty cache loaded it inside its
	// transaction.
	rollback := errors.New("rollback")
	if err := app.RunInTransaction(func(tx core.App) error {
		r := findSettings(tx)
		r.Set("odylePerCube", 80)
		if err := tx.Save(r); err != nil {
			return err
		}
		stateOf(tx).settings.drop()
		if got := readSettings(tx).OdylePerCube; got != 80 {
			t.Errorf("loaded inside the transaction: %d", got)
		}
		return rollback
	}); !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	if got := perCube(); got != 70 {
		t.Fatalf("after a rolled back transaction: %d", got)
	}
	// Without the record the defaults apply again.
	if err := app.Delete(findSettings(app)); err != nil {
		t.Fatal(err)
	}
	if got := perCube(); got != 40 {
		t.Fatalf("without the record: %d", got)
	}
}

func TestTheDungeonCatalogKeepsCostsPartySizesAndCategories(t *testing.T) {
	app := newTestApp(t)
	type entry = map[string]any
	saved, err := writeSettings(app, body{"dungeons": []any{
		"  Krao   Cave ",
		entry{"name": "Abyssal Forge: Ludra", "cost": float64(80), "partySize": float64(10), "category": "  Sanctuary ", "unconfirmed": true},
		entry{"name": "krao cave", "cost": float64(20)},
		entry{"name": "Draupnir", "cost": float64(0), "partySize": float64(0), "category": "", "unconfirmed": false, "mapIds": []any{1}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	// Names alone cost Odyle per cube; a dungeon listed twice keeps its first entry.
	want := []dungeonEntry{{Name: "Krao Cave"}, {Name: "Abyssal Forge: Ludra", Cost: 80, PartySize: 10, Category: "Sanctuary", Unconfirmed: true}, {Name: "Draupnir"}}
	if !slices.Equal(saved.Dungeons, want) || !slices.Equal(readSettings(app).Dungeons, want) {
		t.Fatalf("saved %+v", saved.Dungeons)
	}
	if got := dungeonNames(saved.Dungeons); !slices.Equal(got, []string{"Krao Cave", "Abyssal Forge: Ludra", "Draupnir"}) {
		t.Fatalf("names %v", got)
	}
	for _, bad := range []any{"Krao Cave", []any{float64(42)}, []any{entry{"cost": float64(20)}}, []any{entry{"name": "X", "cost": float64(1001)}}, []any{entry{"name": "X", "cost": float64(-1)}},
		[]any{entry{"name": "X", "cost": 2.5}}, []any{entry{"name": "X", "partySize": float64(6)}}, []any{entry{"name": "X", "partySize": "5"}},
		[]any{entry{"name": "X", "category": strings.Repeat("c", 31)}}, []any{entry{"name": "X", "category": float64(5)}}, []any{entry{"name": "X", "unconfirmed": "yes"}}} {
		if _, err := writeSettings(app, body{"dungeons": bad}); err == nil {
			t.Errorf("accepted %v", bad)
		}
	}
	if got := readSettings(app).Dungeons; !slices.Equal(got, want) {
		t.Fatalf("a refused catalog changed the saved one: %+v", got)
	}
	// New wishlist entries and runs take the catalog's spelling.
	if name, err := catalogName(app, " abyssal  forge: LUDRA"); err != nil || name == nil || name.dungeon != "Abyssal Forge: Ludra" {
		t.Fatalf("listed: %+v, %v", name, err)
	}
	if name, err := catalogName(app, "Nowhere"); err != nil || name != nil {
		t.Fatalf("unlisted: %+v, %v", name, err)
	}
	// A catalog of names from before entries, or one typed under Collections → odyle_settings,
	// still reads; what cannot be read is left out.
	record := findSettings(app)
	record.Set("dungeons", []any{"Fire  Temple", entry{"name": "Udas Temple", "cost": 60}, 42, entry{"name": "Odd", "partySize": 7}})
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if got := readSettings(app).Dungeons; !slices.Equal(got, []dungeonEntry{{Name: "Fire Temple"}, {Name: "Udas Temple", Cost: 60}}) {
		t.Fatalf("stored names read as %+v", got)
	}
}

// The superuser answer keeps `dungeons` the list of names admin pages opened before
// catalog entries read and send back with every save: those names keep their saved
// details, while `catalog` carries and saves the entries.
func TestAdminPagesFromBeforeCatalogEntriesKeepTheCosts(t *testing.T) {
	app := newTestApp(t)
	type entry = map[string]any
	saved, err := writeSettings(app, body{"catalog": []any{entry{"name": "Fire Temple", "cost": float64(60), "partySize": float64(5), "category": "Lower", "unconfirmed": true}, "Udas Temple"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := asJSON(t, saved); !strings.Contains(got, `"dungeons":["Fire Temple","Udas Temple"]`) || !strings.Contains(got, `"catalog":[{"name":"Fire Temple","cost":60,"partySize":5,"category":"Lower","unconfirmed":true},{"name":"Udas Temple","cost":0,"partySize":0,"category":"","unconfirmed":false}]`) {
		t.Fatalf("answer %s", got)
	}
	if got := asJSON(t, defaultSettings()); !strings.Contains(got, `"dungeons":[]`) || !strings.Contains(got, `"catalog":[]`) {
		t.Fatalf("defaults %s", got)
	}
	// An old page saves its game settings with the names it read, one dungeon added.
	saved, err = writeSettings(app, body{"odylePerCube": float64(45), "dungeons": []any{"fire temple", "Udas Temple", "Krao Cave"}})
	if err != nil {
		t.Fatal(err)
	}
	want := []dungeonEntry{{Name: "fire temple", Cost: 60, PartySize: 5, Category: "Lower", Unconfirmed: true}, {Name: "Udas Temple"}, {Name: "Krao Cave"}}
	if !slices.Equal(saved.Dungeons, want) {
		t.Fatalf("names saved as %+v", saved.Dungeons)
	}
	// The catalog itself is saved as given: a name alone costs Odyle per cube.
	if saved, err = writeSettings(app, body{"catalog": []any{"Fire Temple"}, "dungeons": []any{"Ignored"}}); err != nil || !slices.Equal(saved.Dungeons, []dungeonEntry{{Name: "Fire Temple"}}) {
		t.Fatalf("catalog saved as %+v, %v", saved.Dungeons, err)
	}
}

func TestTheCatalogMigrationTurnsNamesIntoEntries(t *testing.T) {
	app := newTestApp(t)
	var migration *core.Migration
	for _, m := range core.AppMigrations.Items() {
		if m.File == "1791763230_catalog_entries.go" {
			migration = m
		}
	}
	if migration == nil {
		t.Fatal("the migration is not registered")
	}
	stored := func() string { return findSettings(app).GetString("dungeons") }
	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	record := findSettings(app)
	record.Set("dungeons", []any{"Fire Temple", "Udas Temple"})
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	if got := stored(); got != `[{"category":"","cost":0,"name":"Fire Temple","partySize":0,"unconfirmed":false},{"category":"","cost":0,"name":"Udas Temple","partySize":0,"unconfirmed":false}]` {
		t.Fatalf("after the migration: %s", got)
	}
	settings, _ := app.FindCollectionByNameOrId("odyle_settings")
	if size := settings.Fields.GetByName("dungeons").(*core.JSONField).MaxSize; size != 200000 {
		t.Fatalf("max size %d", size)
	}
	// Entries saved with costs go back to their names.
	if _, err := writeSettings(app, body{"dungeons": []any{map[string]any{"name": "Fire Temple", "cost": float64(60)}}}); err != nil {
		t.Fatal(err)
	}
	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	if got := stored(); got != `["Fire Temple"]` {
		t.Fatalf("after reverting: %s", got)
	}
	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
}

func BenchmarkSettings(b *testing.B) {
	app := newTestApp(b)
	b.Run("cached", func(b *testing.B) {
		for b.Loop() {
			readSettings(app)
		}
	})
	b.Run("record", func(b *testing.B) {
		for b.Loop() {
			loadSettings(app)
		}
	})
}
