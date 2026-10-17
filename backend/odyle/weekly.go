package odyle

import (
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The room's week in Odyle (#42): one line for the whole party, what the characters shared in
// the room spent since the weekly reset, and the runs that started marked with how many of
// their attendees the readers saw spend the run's cost. From the changes the readers saw, so
// a spend on a PC without the reader counts as a drop at its next reading (or not at all for
// runs). Never per member: no comparison or scoring.

// weekStart is the start of the reset week holding at: the daily reset hour (UTC) of the
// weekly reset day, as src/tasks.js periodStart.
func weekStart(at time.Time, hour int64, day string) time.Time {
	at = at.UTC()
	start := time.Date(at.Year(), at.Month(), at.Day(), int(hour), 0, 0, 0, time.UTC)
	if start.After(at) {
		start = start.AddDate(0, 0, -1)
	}
	want := 3 // wednesday, the default
	for i, name := range weekDays {
		if name == day {
			want = i
		}
	}
	return start.AddDate(0, 0, -((int(start.Weekday()) - want + 7) % 7))
}

// inCharacters is "character IN ({:c0}, …)" with its parameters.
func inCharacters(ids []string, params dbx.Params) string {
	names := make([]string, len(ids))
	for i, id := range ids {
		names[i] = fmt.Sprintf("{:c%d}", i)
		params[fmt.Sprintf("c%d", i)] = id
	}
	return "character IN (" + strings.Join(names, ", ") + ")"
}

// sharedIn is every character shared in the room by its members, once.
func sharedIn(members []*Member) []string {
	out := []string{}
	for _, m := range members {
		for _, c := range m.Shared() {
			if !contains(out, c) {
				out = append(out, c)
			}
		}
	}
	return out
}

// roomWeekOf is what the characters shared in a room spent since the weekly reset: Odyle and
// about how many cubes at the room's cost. A change counts as spent when the app named it a
// spend, or, from apps that do not name changes, when the value dropped from the reading
// before it within the week (as the history's By week, src/history.js weeklyLedger). nil when
// nothing is shared in the room.
func roomWeekOf(app core.App, rules settings, members []*Member, cost int64, at time.Time) (map[string]any, error) {
	shared := sharedIn(members)
	if len(shared) == 0 {
		return nil, nil
	}
	since := weekStart(at, rules.DailyResetHour, rules.WeeklyResetDay)
	params := dbx.Params{"since": stamp(since)}
	query := "SELECT COALESCE(SUM(CASE WHEN kind = 'spend' THEN ABS(delta) WHEN kind IN ('regen', 'item') THEN 0 WHEN previous > value THEN previous - value ELSE 0 END), 0) FROM (SELECT kind, delta, value, LAG(value) OVER (PARTITION BY character ORDER BY created) AS previous FROM character_readings WHERE " + inCharacters(shared, params) + " AND created >= {:since})"
	var spent int64
	if err := app.DB().NewQuery(query).Bind(params).Row(&spent); err != nil {
		return nil, err
	}
	cubes := int64(0)
	if cost > 0 {
		cubes = spent / cost
	}
	return map[string]any{"since": stamp(since), "spent": spent, "cubes": cubes}, nil
}

// runSpendWindow is how long before its start a run's spend counts: a party may take the cube
// a little early.
const runSpendWindow = 15 * time.Minute

// spentAtRun counts the attendees of a run that started whose characters shared in the room
// (their pick, if they picked one) spent the run's cost from 15 minutes before its start, as
// the app named the change. The room then offers Done first.
func spentAtRun(app core.App, r *Run, byId map[string]*Member, cost int64, at time.Time) (int, error) {
	start, ok := parseDate(r.StartsAt())
	if !ok || start.After(at) || cost <= 0 {
		return 0, nil
	}
	owner, characters := map[string]string{}, []string{}
	picks := r.Picks()
	for _, id := range r.Attendees() {
		m := byId[id]
		if m == nil {
			continue
		}
		mine := m.Shared()
		if pick := picks[id]; pick != "" && m.Shares(pick) {
			mine = []string{pick}
		}
		for _, c := range mine {
			owner[c] = id
			characters = append(characters, c)
		}
	}
	if len(characters) == 0 {
		return 0, nil
	}
	params := dbx.Params{"from": stamp(start.Add(-runSpendWindow)), "cost": cost}
	var found []struct {
		Character string `db:"character"`
	}
	if err := app.DB().NewQuery("SELECT DISTINCT character FROM character_readings WHERE " + inCharacters(characters, params) + " AND created >= {:from} AND kind = 'spend' AND ABS(delta) = {:cost}").Bind(params).All(&found); err != nil {
		return 0, err
	}
	spent := map[string]bool{}
	for _, f := range found {
		spent[owner[f.Character]] = true
	}
	return len(spent), nil
}
