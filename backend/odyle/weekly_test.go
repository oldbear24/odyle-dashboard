package odyle

import (
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

func TestWeekStartFollowsTheReset(t *testing.T) {
	at := func(s string) time.Time { return mustTime(t, s) }
	for _, c := range []struct {
		now, day, want string
		hour           int64
	}{
		{"2026-10-14T06:59:00Z", "wednesday", "2026-10-07T07:00:00Z", 7},
		{"2026-10-14T07:00:00Z", "wednesday", "2026-10-14T07:00:00Z", 7},
		{"2026-10-17T21:00:00Z", "wednesday", "2026-10-14T07:00:00Z", 7},
		{"2026-10-18T03:00:00Z", "monday", "2026-10-12T05:00:00Z", 5},
		{"2026-10-18T03:00:00Z", "", "2026-10-14T07:00:00Z", 7},
	} {
		if got := weekStart(at(c.now), c.hour, c.day); !got.Equal(at(c.want)) {
			t.Errorf("%s %s %d: %s, want %s", c.now, c.day, c.hour, got.Format(time.RFC3339), c.want)
		}
	}
}

// addKinds writes readings with the app's kind and delta, each at its own time.
func addKinds(t *testing.T, app core.App, character string, rows []struct {
	value, delta int64
	kind         string
	at           time.Time
}) {
	t.Helper()
	for _, r := range rows {
		if _, err := app.DB().NewQuery("INSERT INTO character_readings (id, character, value, adapter, kind, delta, created) VALUES ({:id}, {:character}, {:value}, 'global-reference-v2', {:kind}, {:delta}, {:created})").
			Bind(dbx.Params{"id": core.GenerateDefaultRandomId(), "character": character, "value": r.value, "kind": r.kind, "delta": r.delta, "created": stamp(r.at)}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTheRoomSeesItsWeekAndRunsSeeTheirSpends(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	lead, mate, other := newUser(t, app, "Lead"), newUser(t, app, "Mate"), newUser(t, app, "Other")
	character := func(user *core.Record, name string) string {
		return saved(t, app, "characters", map[string]any{"user": user.Id, "characterName": name, "server": "EU", "region": "GLOBAL_EU", "parserVersion": "global-reference-v2", "value": 100, "confirmed": true}).Id
	}
	leads, mates, unshared, elsewhere := character(lead, "Leads"), character(mate, "Mates"), character(mate, "Unshared"), character(other, "Elsewhere")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Week", "cost": 40})
	leadMember := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner", "sharedCharacters": []string{leads}})
	mateMember := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter", "sharedCharacters": []string{mates}})
	members, err := roomMembers(app, room.Id)
	if err != nil {
		t.Fatal(err)
	}
	rules := readSettings(app)
	if week, err := roomWeekOf(app, rules, members, 40, time.Now()); err != nil || week["spent"] != int64(0) {
		t.Fatalf("an empty week: %v %v", week, err)
	}

	since := weekStart(time.Now(), rules.DailyResetHour, rules.WeeklyResetDay)
	type row = struct {
		value, delta int64
		kind         string
		at           time.Time
	}
	// Last week's spend does not count; this week: a named spend of 80, a regeneration, an
	// item, and from an older app (no kind) a drop of 40 after a reading of the same week.
	addKinds(t, app, leads, []row{
		{100, -40, "spend", since.Add(-time.Hour)},
		{20, -80, "spend", since.Add(time.Minute)},
		{35, 15, "regen", since.Add(2 * time.Minute)},
		{75, 40, "item", since.Add(3 * time.Minute)},
	})
	addKinds(t, app, mates, []row{{120, 0, "", since.Add(time.Minute)}, {80, 0, "", since.Add(2 * time.Minute)}, {95, 0, "", since.Add(3 * time.Minute)}})
	// Characters not shared in the room do not count.
	addKinds(t, app, unshared, []row{{0, -400, "spend", since.Add(time.Minute)}})
	addKinds(t, app, elsewhere, []row{{0, -400, "spend", since.Add(time.Minute)}})
	week, err := roomWeekOf(app, rules, members, 40, time.Now())
	if err != nil || week["spent"] != int64(120) || week["cubes"] != int64(3) || week["since"] != stamp(since) {
		t.Fatalf("the week: %v %v", week, err)
	}

	// A run that started: the attendees' characters that spent its cost since 15 minutes before.
	started := time.Now().Add(-30 * time.Minute)
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(started), "plannedBy": leadMember.Id, "attendees": []string{leadMember.Id, mateMember.Id}})
	addKinds(t, app, leads, []row{{35, -40, "spend", started.Add(-10 * time.Minute)}})
	addKinds(t, app, mates, []row{{55, -40, "spend", started.Add(-20 * time.Minute)}, {15, -80, "spend", started.Add(time.Minute)}})
	runs, err := runsOf(app, room.Id, members)
	if err != nil || len(runs) != 1 || runs[0].Id != run.Id || runs[0].Spent != 1 {
		t.Fatalf("one of two spent the run's cost in its window: %+v %v", runs, err)
	}
	addKinds(t, app, mates, []row{{0, -40, "spend", started.Add(2 * time.Minute)}})
	if runs, _ = runsOf(app, room.Id, members); runs[0].Spent != 2 {
		t.Fatalf("both spent: %+v", runs)
	}
	// A run that has not started yet counts nothing.
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(time.Hour)), "plannedBy": leadMember.Id, "attendees": []string{leadMember.Id}})
	if runs, _ = runsOf(app, room.Id, members); len(runs) != 2 || runs[1].Spent != 0 {
		t.Fatalf("the later run: %+v", runs)
	}
}
