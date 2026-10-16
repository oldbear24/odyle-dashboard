package odyle

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestTheOdyleClocksRulesAreCheckedAndSaved(t *testing.T) {
	app := newTestApp(t)
	if got := asJSON(t, readSettings(app).Clock); got != `{"tickHours":[1,4,7,10,13,16,19,22],"tick":15,"caps":[560,840],"paused":false}` {
		t.Fatalf("defaults %s", got)
	}
	for _, bad := range []any{
		"x",
		map[string]any{"tickHours": []any{}, "tick": 15.0, "caps": []any{560.0}},
		map[string]any{"tickHours": []any{1.0, 1.0}, "tick": 15.0, "caps": []any{560.0}},
		map[string]any{"tickHours": []any{24.0}, "tick": 15.0, "caps": []any{560.0}},
		map[string]any{"tickHours": []any{1.0}, "tick": 0.0, "caps": []any{560.0}},
		map[string]any{"tickHours": []any{1.0}, "tick": 15.0, "caps": []any{840.0, 560.0}},
		map[string]any{"tickHours": []any{1.0}, "tick": 15.0, "caps": []any{}},
	} {
		if _, err := writeSettings(app, body{"clock": bad}); err == nil {
			t.Errorf("accepted %v", bad)
		}
	}
	saved, err := writeSettings(app, body{"clock": map[string]any{"tickHours": []any{22.0, 4.0, 1.0}, "tick": 10.0, "caps": []any{500.0}, "paused": true}})
	if err != nil || asJSON(t, saved.Clock) != `{"tickHours":[1,4,22],"tick":10,"caps":[500],"paused":true}` {
		t.Fatalf("%v %s", err, asJSON(t, saved.Clock))
	}
}

func TestACharactersReadingsTeachItsTickAndCap(t *testing.T) {
	app := newTestApp(t)
	c, err := findAs[Character](app, "characters", historyCharacter(t, app, "Learner"))
	if err != nil {
		t.Fatal(err)
	}
	parts := func(base, bonus int64) map[string]any { return map[string]any{"base": base, "bonus": bonus} }
	c.Read(reading{value: 910, parts: parts(15, 895), kind: "regen", delta: 15}, "")
	if c.GetInt64("regenTick") != 15 || c.GetInt64("naturalMax") != 15 {
		t.Fatalf("tick %d, max %d", c.GetInt64("regenTick"), c.GetInt64("naturalMax"))
	}
	// A spend lowers the pool but not what it reached; a fuller pool raises it.
	c.Read(reading{value: 830, parts: parts(0, 830), kind: "spend", delta: -80}, "")
	c.Read(reading{value: 1430, parts: parts(600, 830), kind: "snapshot"}, "")
	if c.GetInt64("regenTick") != 15 || c.GetInt64("naturalMax") != 600 {
		t.Fatalf("tick %d, max %d", c.GetInt64("regenTick"), c.GetInt64("naturalMax"))
	}
	// After 30 days the fullest pool is forgotten (a membership that ran out).
	c.Set("naturalMaxAt", stamp(time.Now().Add(-31*24*time.Hour)))
	c.Read(reading{value: 830, parts: parts(100, 730), kind: "snapshot"}, "")
	if c.GetInt64("naturalMax") != 100 {
		t.Fatalf("max %d", c.GetInt64("naturalMax"))
	}
	// Readings without the two numbers teach nothing.
	c.Read(reading{value: 900, kind: "regen", delta: 2000}, "")
	if c.GetInt64("regenTick") != 15 || c.GetInt64("naturalMax") != 100 {
		t.Fatalf("tick %d, max %d", c.GetInt64("regenTick"), c.GetInt64("naturalMax"))
	}
}

func TestTheServerProjectsTheNaturalPoolAsTheDashboardDoes(t *testing.T) {
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	hours := defaultClock().TickHours
	if got := clockTicks(at("2026-10-14T22:30:00Z"), at("2026-10-15T05:00:00Z"), hours, 100); len(got) != 2 || got[0] != at("2026-10-15T01:00:00Z") || got[1] != at("2026-10-15T04:00:00Z") {
		t.Fatalf("ticks %v", got)
	}
	// A tick at the reading's own hour has already happened.
	if got := clockTicks(at("2026-10-15T04:00:00Z"), at("2026-10-15T07:00:00Z"), hours, 100); len(got) != 1 {
		t.Fatalf("ticks %v", got)
	}
	for _, c := range []struct {
		max  int64
		want string
	}{{0, "[560 840]"}, {560, "[560 840]"}, {600, "[840]"}, {2000, "[840]"}} {
		if got := fmt.Sprint(capsFor(c.max, []int64{560, 840})); got != c.want {
			t.Errorf("caps for %d: %s", c.max, got)
		}
	}
	if projectBase(500, 2, 15, 560) != 530 || projectBase(550, 2, 15, 560) != 560 || projectBase(600, 2, 15, 560) != 600 {
		t.Fatal("projection")
	}
}

func TestLoginReadingsCheckTheClock(t *testing.T) {
	app := newTestApp(t)
	before, err := findAs[Character](app, "characters", historyCharacter(t, app, "Checked"))
	if err != nil {
		t.Fatal(err)
	}
	before.Set("parts", map[string]any{"base": 500, "bonus": 300})
	from, _ := time.Parse(time.RFC3339, "2026-10-14T22:30:00Z")
	login := func(base int64, at string) {
		now, _ := time.Parse(time.RFC3339, at)
		checkClock(app, before, from, reading{value: base + 300, parts: map[string]any{"base": base, "bonus": int64(300)}, kind: "snapshot"}, now)
	}
	// Two ticks later the clock projects 530; a reading without a tick between is no check.
	login(530, "2026-10-15T05:00:00Z")
	login(500, "2026-10-14T23:00:00Z")
	summary, problems := clockHealth(app, mustTime(t, "2026-10-15T05:01:00Z"))
	if got := asJSON(t, summary); got != `{"checked":1,"matched":1,"checkedToday":1,"missedToday":0}` || len(problems) != 0 {
		t.Fatalf("%s %v", got, problems)
	}
	// Most of five checks in a day missing tells the operator.
	for range 4 {
		login(510, "2026-10-15T05:00:00Z")
	}
	summary, problems = clockHealth(app, mustTime(t, "2026-10-15T05:01:00Z"))
	if got := asJSON(t, summary); got != `{"checked":5,"matched":1,"checkedToday":5,"missedToday":4}` || !strings.Contains(problems["clock"], "4 of 5 login readings") {
		t.Fatalf("%s %v", got, problems)
	}
	// A week later the checks are gone.
	if summary, _ := clockHealth(app, mustTime(t, "2026-10-22T06:00:00Z")); asJSON(t, summary) != `{"checked":0,"matched":0,"checkedToday":0,"missedToday":0}` {
		t.Fatal(asJSON(t, summary))
	}
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}
