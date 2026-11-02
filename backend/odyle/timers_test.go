package odyle

import (
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// The timers page's game rules are open to anyone and carry nothing of an account.
func TestGameRulesArePublic(t *testing.T) {
	app := newTestApp(t)
	newUser(t, app, "Lead")
	settings := findSettings(app)
	if settings == nil {
		var err error
		if settings, err = newRecord(app, "odyle_settings"); err != nil {
			t.Fatal(err)
		}
	}
	settings.Set("dungeons", []map[string]any{{"name": "Fire Temple", "cost": 80, "partySize": 4, "category": "Dungeons"}})
	settings.Set("maintenance", map[string]any{"day": "wednesday", "hour": 2, "hours": 5})
	settings.Set("dailyResetHour", 7)
	settings.Set("weeklyResetDay", "wednesday")
	if err := app.Save(settings); err != nil {
		t.Fatal(err)
	}
	reuse := func(testing.TB) *tests.TestApp { return app }
	scenario := tests.ApiScenario{Name: "the game rules without an account", Method: http.MethodGet, URL: "/api/odyle/game", ExpectedStatus: 200,
		ExpectedContent:    []string{`"dailyResetHour":7`, `"weeklyResetDay":"wednesday"`, `"tickHours":[1,4,7,10,13,16,19,22]`, `"caps":[560,840]`, `"maintenance":{"day":"wednesday","hour":2,"hours":5}`, `"name":"Fire Temple"`, `"cost":80`, `"odylePerCube":40`, `"serverNow":`},
		NotExpectedContent: []string{"Lead", "announcement", "adapters", "readerPaused"}, TestAppFactory: reuse, DisableTestAppCleanup: true}
	scenario.Test(t)
	if got := timersText(readSettings(app)); got != "The daily reset comes at 07:00 UTC, the weekly reset on Wednesday at the same hour. The natural Odyle pool gains 15 at 01:00, 04:00, 07:00, 10:00, 13:00, 16:00, 19:00 and 22:00 UTC." {
		t.Fatalf("the text before the dashboard runs: %q", got)
	}
	if got := hourList([]int64{9}); got != "09:00 UTC" {
		t.Fatalf("one hour: %q", got)
	}
}
