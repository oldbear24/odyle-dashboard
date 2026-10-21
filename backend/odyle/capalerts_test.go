package odyle

import (
	"strings"
	"testing"
	"time"
)

func TestCapStateFollowsTheOdyleClock(t *testing.T) {
	app := newTestApp(t)
	c, err := findAs[Character](app, "characters", historyCharacter(t, app, "Capped"))
	if err != nil {
		t.Fatal(err)
	}
	rules, at := defaultClock(), mustTime(t, "2026-10-15T14:30:00Z")
	// An account not sure of its membership: the readings decide the cap.
	c.Set("answeredCap", 0)
	read := func(base, max int64, when string) {
		c.Set("parts", map[string]any{"base": base, "bonus": 300})
		c.Set("naturalMax", max)
		c.Set("lastReadingAt", stamp(mustTime(t, when)))
	}
	// 530 at 14:00 with the cap open: 560 after two ticks, 16:00 and 19:00.
	read(530, 530, "2026-10-15T14:00:00Z")
	if state, _ := capState(c, rules, 1, at); state != "" {
		t.Fatalf("two ticks away with one asked: %q", state)
	}
	state, alert := capState(c, rules, 2, at)
	if state != "soon" || asJSON(t, alert) != `{"characterId":"`+c.Id+`","characterName":"Capped","state":"soon","base":530,"cap":560,"settled":false,"tick":15,"at":"2026-10-15T19:00:00.000Z"}` {
		t.Fatalf("%s %s", state, asJSON(t, alert))
	}
	// A tick since the reading counts; a settled cap of 840 is far.
	read(530, 530, "2026-10-15T12:30:00Z")
	if state, alert := capState(c, rules, 1, at); state != "soon" || alert.Base != 545 {
		t.Fatalf("%s %+v", state, alert)
	}
	read(530, 700, "2026-10-15T14:00:00Z")
	if state, _ := capState(c, rules, 1, at); state != "" {
		t.Fatalf("settled at 840: %q", state)
	}
	read(840, 840, "2026-10-15T14:00:00Z")
	if state, alert := capState(c, rules, 0, at); state != "full" || !alert.Settled || alert.At != "" {
		t.Fatalf("%s %+v", state, alert)
	}
	// Characters not read for 30 days and readings without the two numbers are left alone.
	read(560, 560, "2026-09-01T14:00:00Z")
	if state, _ := capState(c, rules, 1, at); state != "" {
		t.Fatalf("old: %q", state)
	}
	c.Set("parts", nil)
	c.Set("lastReadingAt", stamp(at))
	if state, _ := capState(c, rules, 1, at); state != "" {
		t.Fatalf("no parts: %q", state)
	}
}

func TestCapAlertsTellTheOwnerOncePerFill(t *testing.T) {
	app := newTestApp(t)
	id := historyCharacter(t, app, "Filling")
	c, err := findAs[Character](app, "characters", id)
	if err != nil {
		t.Fatal(err)
	}
	user, err := app.FindRecordById("users", c.GetString("user"))
	if err != nil {
		t.Fatal(err)
	}
	notify := func(cap bool, quiet quietHours) {
		n := defaultNotifications()
		n.Kinds.Cap, n.Quiet = cap, quiet
		user.Set("notifications", n)
		if err := app.Save(user); err != nil {
			t.Fatal(err)
		}
	}
	pool := func(base int64) {
		fresh, _ := findAs[Character](app, "characters", id)
		fresh.Set("parts", map[string]any{"base": base, "bonus": 0})
		fresh.Set("value", base)
		fresh.Set("naturalMax", min(base, 560))
		fresh.Set("lastReadingAt", stamp(time.Now()))
		if err := app.Save(fresh); err != nil {
			t.Fatal(err)
		}
	}
	run := func(want int, state string) {
		t.Helper()
		out, err := capAlerts(app)
		fresh, _ := findAs[Character](app, "characters", id)
		if err != nil || out.Done != want || fresh.GetString("capAlert") != state {
			t.Fatalf("%v %+v, state %q", err, out, fresh.GetString("capAlert"))
		}
	}
	pool(550)
	run(0, "") // not asked for
	notify(true, quietHours{})
	run(1, "soon")
	run(0, "soon")
	pool(560)
	run(0, "full") // already told
	pool(100)
	run(0, "")
	// In quiet hours nothing is sent, and nothing is marked: it comes after them.
	now := time.Now().UTC()
	notify(true, quietHours{From: now.Add(-time.Hour).Format("15:04"), To: now.Add(time.Hour).Format("15:04"), TimeZone: "UTC"})
	pool(560)
	run(0, "")
	notify(true, quietHours{})
	run(1, "full")
	// The state is never in a room's or the owner's answers.
	if fresh, _ := findAs[Character](app, "characters", id); strings.Contains(asJSON(t, fresh.PublicExport()), "capAlert") {
		t.Fatal("capAlert is exported")
	}
	if _, err := writeSettings(app, body{"clock": map[string]any{"tickHours": []any{1.0}, "tick": 15.0, "caps": []any{560.0}, "paused": true}}); err != nil {
		t.Fatal(err)
	}
	if out, _ := capAlerts(app); out.Skipped != "clock" {
		t.Fatalf("%+v", out)
	}
}
