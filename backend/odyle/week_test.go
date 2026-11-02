package odyle

import (
	"net/http"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
)

// Your week: the account's own characters read in the week, with their readings of the week and
// the week before from the last one before them; another account's never; weeks the history no
// longer holds are refused.
func TestYourWeekCarriesOnlyYourOwnReadings(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Mine")
	c, err := findAs[Character](app, "characters", id)
	if err != nil {
		t.Fatal(err)
	}
	other := historyCharacter(t, app, "Theirs")
	quiet := saved(t, app, "characters", map[string]any{"user": c.User(), "characterName": "Quiet", "server": "EU", "region": "GLOBAL_EU", "value": 1, "confirmed": true})
	rules := readSettings(app)
	start := weekStart(time.Now(), rules.DailyResetHour, rules.WeeklyResetDay)
	addChanges(t, app, id, []int64{900, 800, 700, 650}, []time.Time{start.AddDate(0, 0, -20), start.AddDate(0, 0, -10), start.AddDate(0, 0, -3), start.Add(time.Minute)})
	addChanges(t, app, other, []int64{100}, []time.Time{start.Add(time.Minute)})
	addChanges(t, app, quiet.Id, []int64{5}, []time.Time{start.AddDate(0, 0, -30)})
	user, err := app.FindRecordById("users", c.User())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB().NewQuery("UPDATE users SET achievements = {:p} WHERE id = {:id}").Bind(dbx.Params{"p": `{"unlocked":{"first-cube":"` + stamp(start.Add(time.Hour)) + `","paired":"` + stamp(start.AddDate(0, 0, -9)) + `"}}`, "id": user.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	auth := tokenOf(t, user)
	got := ask(t, app, http.MethodGet, "/api/odyle/week?week=0", auth, "", 200)
	characters := got["characters"].([]any)
	if len(characters) != 1 || characters[0].(map[string]any)["characterName"] != "Mine" {
		t.Fatalf("characters: %v", characters)
	}
	// The week before from the reading before it: 800 (ten days back) starts it, then 700 and 650.
	values := []float64{}
	for _, r := range characters[0].(map[string]any)["readings"].([]any) {
		values = append(values, r.(map[string]any)["value"].(float64))
	}
	if len(values) != 3 || values[0] != 800 || values[2] != 650 {
		t.Fatalf("readings: %v", values)
	}
	if reached := got["achievements"].([]any); len(reached) != 1 || reached[0].(map[string]any)["id"] != "first-cube" {
		t.Fatalf("achievements of the week: %v", reached)
	}
	w := got["week"].(map[string]any)
	if w["from"] != stamp(start) || w["back"] != float64(0) || w["weeks"] != float64(weeksBack(rules)) || got["odylePerCube"] != float64(40) {
		t.Fatalf("week: %v", w)
	}
	// The week before has the reading of three days before this one.
	if before := ask(t, app, http.MethodGet, "/api/odyle/week?week=1", auth, "", 200); len(before["characters"].([]any)) != 1 || before["week"].(map[string]any)["complete"] != true {
		t.Fatalf("the week before: %v", before)
	}
	ask(t, app, http.MethodGet, "/api/odyle/week?week=99", auth, "", 400)
	ask(t, app, http.MethodGet, "/api/odyle/week?week=-1", auth, "", 400)
	ask(t, app, http.MethodGet, "/api/odyle/week", nil, "", 401)
	if weeksBack(settings{HistoryDays: 30}) != 3 || weeksBack(settings{HistoryDays: 3650}) != weekLimit || weeksBack(settings{HistoryDays: 1}) != 0 {
		t.Fatal("weeks back")
	}
}
