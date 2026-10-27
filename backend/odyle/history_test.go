package odyle

import (
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// historyCharacter saves a character while portraits are paused, so no lookup starts.
func historyCharacter(t *testing.T, app core.App, name string) string {
	t.Helper()
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	user := newUser(t, app, name)
	return saved(t, app, "characters", map[string]any{"user": user.Id, "characterName": name, "server": "EU", "region": "GLOBAL_EU", "parserVersion": "global-reference-v1", "value": 1, "confirmed": true}).Id
}

// addChanges writes history points straight into the database, each at its own time.
func addChanges(t *testing.T, app core.App, character string, values []int64, at []time.Time) {
	t.Helper()
	if err := app.RunInTransaction(func(tx core.App) error {
		for i, value := range values {
			if _, err := tx.DB().NewQuery("INSERT INTO character_readings (id, character, value, adapter, created) VALUES ({:id}, {:character}, {:value}, {:adapter}, {:created})").
				Bind(dbx.Params{"id": core.GenerateDefaultRandomId(), "character": character, "value": value, "adapter": "global-reference-v2", "created": stamp(at[i])}).Execute(); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestHistoryListsEveryChangeOfAQuietCharacter(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Quiet")
	start := time.Now().Add(-29 * 24 * time.Hour)
	addChanges(t, app, id, []int64{10, 20, 30, 40}, []time.Time{start.Add(-48 * time.Hour), start, start.Add(time.Minute), time.Now().Add(-time.Hour)})
	readings, hourlyBefore, err := historyOf(app, id, 30)
	if err != nil || hourlyBefore != "" {
		t.Fatalf("%v, hourly before %q", err, hourlyBefore)
	}
	values := []int64{}
	for _, r := range readings {
		point := r.(map[string]any)
		values = append(values, point["value"].(int64))
		if point["adapter"] != "global-reference-v2" {
			t.Errorf("adapter %v", point["adapter"])
		}
	}
	// The change from 31 days ago is outside the window.
	if len(values) != 3 || values[0] != 20 || values[2] != 40 {
		t.Fatalf("values %v", values)
	}
}

func TestHistoryOfABusyCharacterStillStartsThirtyDaysAgo(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Busy")
	// Three changes in one hour four weeks ago, then two more hours later; then 1,060
	// changes a minute apart up to an hour ago.
	start := time.Now().Add(-28 * 24 * time.Hour).Truncate(time.Hour).Add(5 * time.Minute)
	values, at := []int64{1, 2, 3, 4, 5}, []time.Time{start, start.Add(10 * time.Minute), start.Add(20 * time.Minute), start.Add(3 * time.Hour), start.Add(5 * time.Hour)}
	recent := time.Now().Add(-time.Hour - 1060*time.Minute)
	for i := range 1060 {
		values, at = append(values, int64(1000+i)), append(at, recent.Add(time.Duration(i)*time.Minute))
	}
	addChanges(t, app, id, values, at)
	readings, hourlyBefore, err := historyOf(app, id, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(readings) <= historyExact || len(readings) > historyExact+721 {
		t.Fatalf("%d points", len(readings))
	}
	point := func(i int) (int64, string) {
		p := readings[i].(map[string]any)
		return p["value"].(int64), p["at"].(string)
	}
	// The month starts with the last change of each early hour.
	for i, want := range []int64{3, 4, 5} {
		if value, _ := point(i); value != want {
			t.Fatalf("point %d is %d, not %d", i, value, want)
		}
	}
	// The newest 1,000 changes are all there, the oldest of them at hourlyBefore.
	exact := len(readings) - historyExact
	if first, firstAt := point(exact); first != 1060 || firstAt != hourlyBefore {
		t.Fatalf("first listed change %d at %s, hourly before %s", first, firstAt, hourlyBefore)
	}
	if last, _ := point(len(readings) - 1); last != 2059 {
		t.Fatalf("last change %d", last)
	}
	// Oldest first, and before hourlyBefore one point per hour.
	hours := map[string]bool{}
	for i := range readings {
		_, when := point(i)
		if i > 0 {
			if _, before := point(i - 1); before >= when {
				t.Fatalf("point %d at %s follows %s", i, when, before)
			}
		}
		if i < exact {
			if when >= hourlyBefore || hours[when[:13]] {
				t.Fatalf("point %d at %s is not the hour's only one before %s", i, when, hourlyBefore)
			}
			hours[when[:13]] = true
		}
	}
}

func TestUpgradeTagsSavedHistoryWithTheCharacterAdapter(t *testing.T) {
	app := newTestApp(t)
	var tagging *core.Migration
	for _, m := range core.AppMigrations.Items() {
		if m.File == "1791763224_reading_adapters.go" {
			tagging = m
		}
	}
	if tagging == nil {
		t.Fatal("the adapter migration is not registered")
	}
	// A history point saved before the migration.
	if err := tagging.Down(app); err != nil {
		t.Fatal(err)
	}
	id := historyCharacter(t, app, "Veteran")
	point := saved(t, app, "character_readings", map[string]any{"character": id, "value": 390})
	if err := tagging.Up(app); err != nil {
		t.Fatal(err)
	}
	got, err := findAs[HistoryPoint](app, "character_readings", point.Id)
	if err != nil || got.Adapter() != "global-reference-v1" {
		t.Fatalf("adapter %q: %v", got.Adapter(), err)
	}
}
