package odyle

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Activation and feature use for the Server status page: how many accounts reached each
// step from signing in to reading together in a room, and how many rooms and accounts
// use each feature. Only totals are computed, from the stored data: nothing follows a
// single account, and only superusers see them. The odyle-stats job keeps one row of
// them a day (odyle_stats, migration 1791763228_odyle_stats.go), so the trend survives
// restarts; the page shows the last 30 days.

// A character with a game reading (manual values of the first releases do not count).
const readCharacter = "c.source = 'packet' AND c.confirmed = TRUE"

// The characters a membership shares, one row each.
const sharedCharacters = "json_each(CASE WHEN json_valid(m.sharedCharacters) THEN m.sharedCharacters ELSE '[]' END) s JOIN characters c ON c.id = s.value"

// statQueries are a day's totals, in the order the page shows them. The funnel steps
// count accounts that reached at least that step, so each is part of the one before.
var statQueries = []struct{ name, query string }{
	// Accounts, and those that used the dashboard or the Windows app in the last 24 hours.
	{"accounts", "SELECT COUNT(*) FROM users"},
	{"activeAccounts", "SELECT COUNT(*) FROM users WHERE lastActiveAt >= {:day}"},
	// Paired a Windows app: a paired PC, a reader session or a reading, which needs one.
	{"pairedAccounts", "SELECT COUNT(*) FROM users u WHERE EXISTS (SELECT 1 FROM desktop_devices d WHERE d.user = u.id) OR EXISTS (SELECT 1 FROM publisher_sessions p WHERE p.user = u.id) OR EXISTS (SELECT 1 FROM characters c WHERE c.user = u.id AND " + readCharacter + ")"},
	{"readingAccounts", "SELECT COUNT(DISTINCT c.user) FROM characters c WHERE " + readCharacter},
	// Shares a character with a reading in a room.
	{"sharingAccounts", "SELECT COUNT(DISTINCT m.user) FROM room_members m, " + sharedCharacters + " WHERE " + readCharacter},
	// Rooms where two or more members' shared characters were read in the last 7 days.
	{"roomsReading", "SELECT COUNT(*) FROM (SELECT m.room FROM room_members m, " + sharedCharacters + " WHERE " + readCharacter + " AND c.lastSeenAt >= {:week} GROUP BY m.room HAVING COUNT(DISTINCT m.user) >= 2)"},
	// Odyle changes saved in the last 24 hours (history points).
	{"readings", "SELECT COUNT(*) FROM character_readings WHERE created >= {:day}"},
	// Rooms with a run from yesterday to 7 days ahead; runs are deleted a day after they start.
	{"roomsWithRuns", "SELECT COUNT(DISTINCT room) FROM room_runs WHERE startsAt >= {:day} AND startsAt < {:weekAhead}"},
	{"wishlistEntries", "SELECT COUNT(*) FROM room_wishes"},
	{"taskAccounts", "SELECT COUNT(DISTINCT user) FROM user_tasks"},
	{"discordRooms", "SELECT COUNT(*) FROM party_rooms WHERE discordWebhook != ''"},
}

// versionUse is how many Windows apps run a version: apps in contact in the last 24
// hours (their reader session has not expired), one per paired PC.
type versionUse struct {
	Version string `db:"version" json:"version"`
	Apps    int64  `db:"apps" json:"apps"`
}

// currentStats are the totals now.
func currentStats(app core.App, at time.Time) (*object, error) {
	params := dbx.Params{"day": stamp(at.Add(-24 * time.Hour)), "week": stamp(at.Add(-7 * 24 * time.Hour)), "weekAhead": stamp(at.Add(7 * 24 * time.Hour)), "now": stamp(at)}
	out := newObject()
	for _, q := range statQueries {
		var n int64
		if err := app.DB().NewQuery(q.query).Bind(params).Row(&n); err != nil {
			return nil, err
		}
		out.set(q.name, n)
	}
	versions := []versionUse{}
	err := app.DB().NewQuery("SELECT appVersion AS version, COUNT(DISTINCT CASE WHEN device != '' THEN device ELSE id END) AS apps FROM publisher_sessions WHERE expiresAt > {:now} GROUP BY appVersion ORDER BY apps DESC, version DESC LIMIT 50").
		Bind(params).All(&versions)
	return out.set("appVersions", versions), err
}

// recordStats is the nightly job that stores today's totals (UTC), replacing a row the
// job already stored today.
func recordStats(app core.App) (result, error) {
	at := time.Now()
	totals, err := currentStats(app, at)
	if err != nil {
		return result{}, err
	}
	day := at.UTC().Format("2006-01-02")
	record, err := app.FindFirstRecordByData("odyle_stats", "day", day)
	if err != nil {
		if record, err = newRecord(app, "odyle_stats"); err != nil {
			return result{}, err
		}
		record.Set("day", day)
	}
	for _, key := range totals.keys {
		record.Set(key, totals.values[key])
	}
	if err := app.Save(record); err != nil {
		return result{}, err
	}
	return result{Done: 1}, nil
}

// statDays are the stored days, newest first.
func statDays(app core.App, limit int) ([]*object, error) {
	found, err := app.FindRecordsByFilter("odyle_stats", "day != ''", "-day", limit, 0)
	if err != nil {
		return nil, err
	}
	out := make([]*object, len(found))
	for i, r := range found {
		row := newObject().set("day", r.GetString("day"))
		for _, q := range statQueries {
			row.set(q.name, r.GetInt(q.name))
		}
		out[i] = row.set("appVersions", parseJSON(r.GetString("appVersions"), "[]"))
	}
	return out, nil
}

// activation is the Server status page's view: the totals now and the last 30 days.
func activation(app core.App) (*object, error) {
	current, err := currentStats(app, time.Now())
	if err != nil {
		return nil, err
	}
	days, err := statDays(app, 30)
	if err != nil {
		return nil, err
	}
	return newObject().set("now", current).set("days", days), nil
}
