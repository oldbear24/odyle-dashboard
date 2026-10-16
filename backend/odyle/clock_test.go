package odyle

import (
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
