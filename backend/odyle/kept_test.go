package odyle

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// Superusers set how long the history and the places are kept: 1 day to ten years, 30 by default.
func TestKeptDaysAreSettings(t *testing.T) {
	app := newTestApp(t)
	if s := readSettings(app); s.HistoryDays != 30 || s.LocationDays != 30 {
		t.Fatalf("kept %d and %d days by default, want 30", s.HistoryDays, s.LocationDays)
	}
	for _, bad := range []body{{"historyDays": float64(0)}, {"historyDays": float64(3651)}, {"locationDays": 1.5}, {"locationDays": "365"}} {
		if _, err := writeSettings(app, bad); err == nil {
			t.Errorf("%v was saved", bad)
		}
	}
	s, err := writeSettings(app, body{"historyDays": float64(365), "locationDays": float64(1)})
	if err != nil || s.HistoryDays != 365 || s.LocationDays != 1 {
		t.Fatalf("saved %d and %d days: %v", s.HistoryDays, s.LocationDays, err)
	}
	// A record with no period (cleared under Collections) keeps the default.
	record := findSettings(app)
	record.Set("historyDays", 0)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	if s := readSettings(app); s.HistoryDays != 30 || s.LocationDays != 1 {
		t.Fatalf("read %d and %d days", s.HistoryDays, s.LocationDays)
	}
}

// The expiry job keeps the history and the places as long as the settings say.
func TestCleanupKeepsWhatTheSettingsKeep(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Keeper")
	at := time.Now()
	addChanges(t, app, id, []int64{1, 2, 3}, []time.Time{at.Add(-400 * 24 * time.Hour), at.Add(-31 * 24 * time.Hour), at.Add(-time.Hour)})
	for _, days := range []int{9, 2} {
		place := saved(t, app, "character_locations", map[string]any{"character": id, "map": 1110, "x": 1, "y": 2, "z": 3, "source": "load"})
		if _, err := app.DB().NewQuery("UPDATE character_locations SET created = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": stamp(at.Add(-time.Duration(days) * 24 * time.Hour)), "id": place.Id}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := writeSettings(app, body{"historyDays": float64(365), "locationDays": float64(7)}); err != nil {
		t.Fatal(err)
	}
	if _, err := cleanup(app); err != nil {
		t.Fatal(err)
	}
	if readings, places := countOf(t, app, "character_readings"), countOf(t, app, "character_locations"); readings != 2 || places != 1 {
		t.Fatalf("%d readings and %d places kept, want 2 and 1", readings, places)
	}
}

// get answers a signed-in GET of the test app as decoded JSON.
func get(t *testing.T, app *tests.TestApp, user *core.Record, url string) map[string]any {
	t.Helper()
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	var answer map[string]any
	reuse := func(testing.TB) *tests.TestApp { return app }
	(&tests.ApiScenario{Name: url, Method: http.MethodGet, URL: url, Headers: map[string]string{"Authorization": token}, TestAppFactory: reuse, DisableTestAppCleanup: true, ExpectedStatus: 200, ExpectedContent: []string{"serverNow"},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			if err := json.NewDecoder(res.Body).Decode(&answer); err != nil {
				t.Fatal(err)
			}
		}}).Test(t)
	return answer
}

// The history answers the asked period up to what is kept, and pages through its changes one by one.
func TestHistoryPeriodsAndPages(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Pager")
	c, err := app.FindRecordById("characters", id)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := app.FindRecordById("users", c.GetString("user"))
	if err != nil {
		t.Fatal(err)
	}
	// 45 changes a day apart, the newest an hour ago: 10, 20, … 450.
	at := time.Now().Add(-time.Hour)
	values, times := []int64{}, []time.Time{}
	for i := range 45 {
		values, times = append(values, int64(10*(i+1))), append(times, at.Add(-time.Duration(44-i)*24*time.Hour))
	}
	addChanges(t, app, id, values, times)
	points := func(answer map[string]any) int { return len(answer["readings"].([]any)) }
	if a := get(t, app, owner, "/api/odyle/history/"+id); points(a) != 30 || a["days"] != float64(30) || a["keepDays"] != float64(30) {
		t.Fatalf("%d points of %v days, kept %v", points(a), a["days"], a["keepDays"])
	}
	if a := get(t, app, owner, "/api/odyle/history/"+id+"?days=7"); points(a) != 7 || a["days"] != float64(7) {
		t.Fatalf("%d points of %v days", points(a), a["days"])
	}
	// No more than is kept.
	if a := get(t, app, owner, "/api/odyle/history/"+id+"?days=365"); points(a) != 30 || a["days"] != float64(30) {
		t.Fatalf("%d points of %v days", points(a), a["days"])
	}
	if _, err := writeSettings(app, body{"historyDays": float64(365)}); err != nil {
		t.Fatal(err)
	}
	if a := get(t, app, owner, "/api/odyle/history/"+id+"?days=365"); points(a) != 45 || a["days"] != float64(365) || a["keepDays"] != float64(365) {
		t.Fatalf("%d points of %v days, kept %v", points(a), a["days"], a["keepDays"])
	}
	// Pages of 20, newest first, each with its change from the one before.
	page := get(t, app, owner, "/api/odyle/history/"+id+"/changes?days=365")
	changes := page["changes"].([]any)
	if len(changes) != 20 || page["total"] != float64(45) || page["pages"] != float64(3) || page["page"] != float64(1) || page["perPage"] != float64(20) {
		t.Fatalf("first page: %d changes, %v", len(changes), page)
	}
	if first := changes[0].(map[string]any); first["value"] != float64(450) || first["change"] != float64(10) {
		t.Fatalf("newest change %v", first)
	}
	last := get(t, app, owner, "/api/odyle/history/"+id+"/changes?days=365&page=3")
	changes = last["changes"].([]any)
	if len(changes) != 5 || changes[4].(map[string]any)["value"] != float64(10) || changes[4].(map[string]any)["change"] != nil || changes[3].(map[string]any)["change"] != float64(10) {
		t.Fatalf("last page %v", changes)
	}
	// The first change of a shorter period has nothing before it in the period.
	week := get(t, app, owner, "/api/odyle/history/"+id+"/changes?days=7&perPage=5&page=2")
	changes = week["changes"].([]any)
	if len(changes) != 2 || week["total"] != float64(7) || week["pages"] != float64(2) || changes[1].(map[string]any)["change"] != nil {
		t.Fatalf("a week's second page %v", week)
	}
	// Other accounts read neither.
	stranger := newUser(t, app, "Stranger")
	token, err := stranger.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	reuse := func(testing.TB) *tests.TestApp { return app }
	(&tests.ApiScenario{Name: "a stranger", Method: http.MethodGet, URL: "/api/odyle/history/" + id + "/changes", Headers: map[string]string{"Authorization": token}, TestAppFactory: reuse, DisableTestAppCleanup: true, ExpectedStatus: 403, ExpectedContent: []string{"This character is not shared with you."}}).Test(t)
	(&tests.ApiScenario{Name: "signed out", Method: http.MethodGet, URL: "/api/odyle/history/" + id + "/changes", TestAppFactory: reuse, DisableTestAppCleanup: true, ExpectedStatus: 401, ExpectedContent: []string{`"message"`}}).Test(t)
}

// With ?page= the places come a page at a time, with how many are kept; without, as before.
func TestPlacesComeInPages(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Wanderer")
	c, err := app.FindRecordById("characters", id)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := app.FindRecordById("users", c.GetString("user"))
	if err != nil {
		t.Fatal(err)
	}
	owner.Set("shareLocation", true)
	if err := app.Save(owner); err != nil {
		t.Fatal(err)
	}
	at := time.Now()
	for i := range 25 {
		place := saved(t, app, "character_locations", map[string]any{"character": id, "map": 1000 + i, "x": 1, "y": 2, "z": 3, "source": "load"})
		if _, err := app.DB().NewQuery("UPDATE character_locations SET created = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": stamp(at.Add(-time.Duration(25-i) * time.Hour)), "id": place.Id}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	all := get(t, app, owner, "/api/odyle/locations/"+id)
	if len(all["locations"].([]any)) != 25 || all["keepDays"] != float64(30) || all["page"] != nil {
		t.Fatalf("without a page: %v", all)
	}
	second := get(t, app, owner, "/api/odyle/locations/"+id+"?page=2&perPage=10")
	places := second["locations"].([]any)
	if len(places) != 10 || second["total"] != float64(25) || second["pages"] != float64(3) || second["page"] != float64(2) || places[0].(map[string]any)["map"] != float64(1014) {
		t.Fatalf("second page: %v", second)
	}
	// Turned off, a page is empty.
	owner.Set("shareLocation", false)
	if err := app.Save(owner); err != nil {
		t.Fatal(err)
	}
	if off := get(t, app, owner, "/api/odyle/locations/"+id+"?page=1"); len(off["locations"].([]any)) != 0 || off["total"] != float64(0) || off["pages"] != float64(1) || off["shared"] != false {
		t.Fatalf("off: %v", off)
	}
}

// A history longer than a month keeps each day's last change before its newest 1,000.
func TestLongHistoriesAreThinnedByDay(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Daily")
	// Three changes on each of 40 days, then 1,000 a minute apart up to an hour ago.
	start := time.Now().Add(-60 * 24 * time.Hour).Truncate(24 * time.Hour).Add(time.Hour)
	values, at := []int64{}, []time.Time{}
	for day := range 40 {
		for i := range 3 {
			values, at = append(values, int64(day*10+i)), append(at, start.Add(time.Duration(day)*24*time.Hour+time.Duration(i)*time.Hour))
		}
	}
	recent := time.Now().Add(-time.Hour - 1000*time.Minute)
	for i := range 1000 {
		values, at = append(values, int64(5000+i)), append(at, recent.Add(time.Duration(i)*time.Minute))
	}
	addChanges(t, app, id, values, at)
	readings, hourlyBefore, err := historyOf(app, id, 90)
	if err != nil || hourlyBefore == "" || thinnedTo(90) != "day" || thinnedTo(31) != "hour" {
		t.Fatalf("%v, thinned before %q", err, hourlyBefore)
	}
	if len(readings) != 1040 {
		t.Fatalf("%d points, want 40 days and 1,000 changes", len(readings))
	}
	if first := readings[0].(map[string]any); first["value"] != int64(2) {
		t.Fatalf("the first day is %v, not its last change", first["value"])
	}
}
