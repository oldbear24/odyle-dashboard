package odyle

import (
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The funnel counts each account at the furthest step it reached, and feature use counts
// rooms and accounts, never who they are.
func TestActivationCountsEachStepAndFeature(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	at := time.Now()
	reader, mate, idle, sessionOnly, unread := newUser(t, app, "Reader"), newUser(t, app, "Mate"), newUser(t, app, "Idle"), newUser(t, app, "SessionOnly"), newUser(t, app, "Unread")
	for _, user := range []*core.Record{reader, mate} {
		user.Set("lastActiveAt", stamp(at))
		if err := app.Save(user); err != nil {
			t.Fatal(err)
		}
	}
	pc := saved(t, app, "desktop_devices", map[string]any{"user": reader.Id, "digest": "reader-pc", "name": "READER-PC"})
	for range 2 {
		saved(t, app, "publisher_sessions", map[string]any{"user": reader.Id, "device": pc.Id, "appVersion": "0.6.0.12", "expiresAt": expiry(86400)})
	}
	saved(t, app, "publisher_sessions", map[string]any{"user": sessionOnly.Id, "appVersion": "0.5.0.1", "expiresAt": expiry(86400)})
	saved(t, app, "publisher_sessions", map[string]any{"user": sessionOnly.Id, "appVersion": "0.5.0.1", "expiresAt": stamp(at.Add(-time.Hour))})
	character := func(user *core.Record, name string, seen time.Time) *core.Record {
		return saved(t, app, "characters", map[string]any{"user": user.Id, "characterName": name, "server": "Lumiel", "region": "GLOBAL_EU", "value": 100, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": stamp(seen)})
	}
	read, mateRead := character(reader, "Read", at), character(mate, "Mate", at.Add(-2*24*time.Hour))
	named := saved(t, app, "characters", map[string]any{"user": unread.Id, "characterName": "Named", "server": "Lumiel", "region": "GLOBAL_EU", "confirmed": false})
	saved(t, app, "character_readings", map[string]any{"character": read.Id, "value": 100})
	room := saved(t, app, "party_rooms", map[string]any{"owner": reader.Id, "name": "Together", "cost": 40, "discordWebhook": "https://discord.com/api/webhooks/12345/abcdefghijklmnopqrstuvwxyz"})
	other := saved(t, app, "party_rooms", map[string]any{"owner": unread.Id, "name": "Alone", "cost": 40})
	owner := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": reader.Id, "role": "owner", "sharedCharacters": []string{read.Id}})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter", "sharedCharacters": []string{mateRead.Id}})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": idle.Id, "role": "viewer"})
	lonely := saved(t, app, "room_members", map[string]any{"room": other.Id, "user": unread.Id, "role": "owner", "sharedCharacters": []string{named.Id}})
	saved(t, app, "room_wishes", map[string]any{"room": room.Id, "member": owner.Id, "dungeon": "Fire Temple", "key": "fire temple"})
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(at.Add(48 * time.Hour)), "plannedBy": owner.Id, "attendees": []string{owner.Id}})
	saved(t, app, "room_runs", map[string]any{"room": other.Id, "dungeon": "Fire Temple", "startsAt": stamp(at.Add(10 * 24 * time.Hour)), "plannedBy": lonely.Id, "attendees": []string{lonely.Id}})
	for _, title := range []string{"Daily quest", "Weekly boss"} {
		saved(t, app, "user_tasks", map[string]any{"user": reader.Id, "title": title, "cadence": "daily"})
	}
	totals, err := currentStats(app, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	want := `{"accounts":5,"activeAccounts":2,"pairedAccounts":3,"readingAccounts":2,"sharingAccounts":2,"roomsReading":1,"readings":1,"roomsWithRuns":1,"wishlistEntries":1,"taskAccounts":1,"discordRooms":1,"appVersions":[{"version":"0.6.0.12","apps":1},{"version":"0.5.0.1","apps":1}]}`
	if got := asJSON(t, totals); got != want {
		t.Fatalf("totals = %s", got)
	}
	// A room reads together only while two members' characters were read in the last week.
	mateRead.Set("lastSeenAt", stamp(at.Add(-8*24*time.Hour)))
	if err := app.Save(mateRead); err != nil {
		t.Fatal(err)
	}
	if totals, err = currentStats(app, time.Now()); err != nil || totals.values["roomsReading"] != int64(0) {
		t.Fatalf("a week later: %v, %v", totals.values["roomsReading"], err)
	}
	// No account is named anywhere in the totals.
	if got := asJSON(t, totals); strings.Contains(got, reader.Id) || strings.Contains(got, "Reader") {
		t.Fatalf("totals name an account: %s", got)
	}
}

// The nightly job keeps one row a day; running it again the same day replaces it.
func TestTheStatsJobKeepsOneRowADay(t *testing.T) {
	app := newTestApp(t)
	newUser(t, app, "Counted")
	for range 2 {
		if out, err := recordStats(app); err != nil || out.Done != 1 {
			t.Fatalf("%v, %v", out, err)
		}
	}
	newUser(t, app, "CountedLater")
	if _, err := recordStats(app); err != nil {
		t.Fatal(err)
	}
	if n := countOf(t, app, "odyle_stats"); n != 1 {
		t.Fatalf("%d rows", n)
	}
	// An earlier day stays.
	yesterday := saved(t, app, "odyle_stats", map[string]any{"day": time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02"), "accounts": 1, "appVersions": []any{}})
	days, err := statDays(app, 30)
	if err != nil || len(days) != 2 {
		t.Fatalf("%d days, %v", len(days), err)
	}
	today := days[0].values
	if today["day"] != time.Now().UTC().Format("2006-01-02") || today["accounts"] != 2 || days[1].values["day"] != yesterday.GetString("day") {
		t.Fatalf("days = %s", asJSON(t, days))
	}
	shown, err := activation(app)
	if err != nil || len(shown.values["days"].([]*object)) != 2 || shown.values["now"].(*object).values["accounts"] != int64(2) {
		t.Fatalf("activation = %v, %v", asJSON(t, shown), err)
	}
}

// Before a period is saved, the Game settings page shows how many accounts the next
// clean-up would delete with it.
func TestTheRetentionPreviewCountsTonightsDeletions(t *testing.T) {
	app := newTestApp(t)
	at := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	for i, days := range []int{400, 100, 40, 10} {
		user := newUser(t, app, "Unused"+string(rune('A'+i)))
		user.Set("lastActiveAt", stamp(at.Add(-time.Duration(days)*24*time.Hour)))
		if err := app.Save(user); err != nil {
			t.Fatal(err)
		}
	}
	preview := func(days int64) string {
		out, err := retentionPreview(app, days, at)
		if err != nil {
			t.Fatal(err)
		}
		return asJSON(t, out)
	}
	// The run tonight at 03:17 UTC: an account unused for 30 days by then counts.
	if got := preview(30); got != `{"days":30,"runAt":"2026-10-16T03:17:00.000Z","inactive":3,"deleted":3}` {
		t.Errorf("30 days: %s", got)
	}
	if got := preview(365); got != `{"days":365,"runAt":"2026-10-16T03:17:00.000Z","inactive":1,"deleted":1}` {
		t.Errorf("365 days: %s", got)
	}
	if got := preview(0); got != `{"days":0,"runAt":"2026-10-16T03:17:00.000Z","inactive":0,"deleted":0}` {
		t.Errorf("kept: %s", got)
	}
	if got := nextDaily("17 3 * * *", time.Date(2026, 10, 15, 3, 17, 0, 0, time.UTC)); !got.Equal(time.Date(2026, 10, 15, 3, 17, 0, 0, time.UTC)) {
		t.Errorf("next run at its own minute: %v", got)
	}
	for _, bad := range []any{float64(10), float64(4000), float64(1.5), "30", nil} {
		if _, err := inactiveDays(bad); err == nil {
			t.Errorf("%v was accepted", bad)
		}
	}
}
