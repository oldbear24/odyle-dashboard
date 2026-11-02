package odyle

import (
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// auditLog answers the audit route for a superuser, decoded, with its entries.
func auditLog(t *testing.T, app *tests.TestApp, operator *core.Record, query string) (map[string]any, []map[string]any) {
	t.Helper()
	out := ask(t, app, http.MethodGet, "/api/odyle/admin/audit"+query, tokenOf(t, operator), "", 200)
	raw, _ := out["entries"].([]any)
	entries := make([]map[string]any, len(raw))
	for i, e := range raw {
		entries[i] = e.(map[string]any)
	}
	return out, entries
}

// Each setting a save changed is named as the pages name it, with what it was: values before
// and after, list entries added, removed and changed (by their name), or only reordered.
func TestSettingsChangesNameEachValueThatChanged(t *testing.T) {
	before, after := defaultSettings(), defaultSettings()
	before.Dungeons = []dungeonEntry{{Name: "Fire Temple", Cost: 60}, {Name: "Udas Temple"}}
	after.OdylePerCube, after.ReaderPaused, after.Announcement = 45, true, "Maintenance"
	after.Clock.Tick, after.Clock.TickHours = 20, []int64{1, 4, 7, 10, 13, 16, 19, 23}
	after.Dungeons = []dungeonEntry{{Name: "fire temple", Cost: 80}, {Name: "Krao Cave"}}
	after.WindowsBlocked = []string{"0.18.0"}
	changes := settingsChanges(before, after)
	got := []string{}
	for _, c := range changes {
		got = append(got, c.describe())
	}
	want := []string{"Odyle per cube 40 → 45", "Dungeon catalog: 1 added, 1 removed, 1 changed", "Regeneration hours (UTC): +23, −22", "Odyle per tick 15 → 20",
		"Announcement none → “Maintenance”", "Pause packet readers: on", "Held-back Windows versions: +0.18.0"}
	if !slices.Equal(got, want) {
		t.Fatalf("changes %q", got)
	}
	if summary := settingsSummary(changes); summary != "Odyle per cube 40 → 45 · Dungeon catalog: 1 added, 1 removed, 1 changed · Regeneration hours (UTC): +23, −22 · Odyle per tick 15 → 20 · 3 more changes" {
		t.Fatalf("summary %q", summary)
	}
	// What a value was is kept even when it was false, 0 or empty.
	if got := asJSON(t, changes[5]); got != `{"field":"readerPaused","label":"Pause packet readers","before":false,"after":true}` {
		t.Fatalf("switch %s", got)
	}
	if got := asJSON(t, changes[1]); got != `{"field":"catalog","label":"Dungeon catalog","added":[{"category":"","cost":0,"name":"Krao Cave","partySize":0,"unconfirmed":false}],"removed":[{"category":"","cost":0,"name":"Udas Temple","partySize":0,"unconfirmed":false}],"changed":[{"before":{"category":"","cost":60,"name":"Fire Temple","partySize":0,"unconfirmed":false},"after":{"category":"","cost":80,"name":"fire temple","partySize":0,"unconfirmed":false}}]}` {
		t.Fatalf("catalog %s", got)
	}
	// The same entries in another order are one change; the same settings are none.
	after = before
	after.Dungeons = []dungeonEntry{{Name: "Udas Temple"}, {Name: "Fire Temple", Cost: 60}}
	if changes := settingsChanges(before, after); len(changes) != 1 || changes[0].describe() != "Dungeon catalog: reordered" {
		t.Fatalf("reordered %+v", changes)
	}
	if changes := settingsChanges(before, before); len(changes) != 0 {
		t.Fatalf("no change %+v", changes)
	}
	// A schedule reads as its UTC time; a single change is the whole summary.
	after = before
	after.AnnouncementUntil = "2026-11-05T10:00:00.000Z"
	if summary := settingsSummary(settingsChanges(before, after)); summary != "Announcement shown until none → 2026-11-05 10:00 UTC" {
		t.Fatalf("schedule %q", summary)
	}
}

// Every save on the Odyle pages is recorded with the superuser who made it and what it
// changed; a save that changes nothing, or is refused, is not. Only superusers read the log.
func TestSettingsSavesAreAuditedWithWhoAndWhat(t *testing.T) {
	app := newTestApp(t)
	operator, lead := newOperator(t, app), newUser(t, app, "Lead")
	ask(t, app, http.MethodGet, "/api/odyle/admin/audit", nil, "", 401)
	ask(t, app, http.MethodGet, "/api/odyle/admin/audit", tokenOf(t, lead), "", 403)
	if _, entries := auditLog(t, app, operator, ""); len(entries) != 0 {
		t.Fatalf("a new server logged %v", entries)
	}

	saved := ask(t, app, http.MethodPost, "/api/odyle/admin/settings", tokenOf(t, operator), `{"odylePerCube":45,"readerPaused":true,"announcement":"Maintenance"}`, 200)
	last, _ := saved["lastChange"].(map[string]any)
	const summary = "Odyle per cube 40 → 45 · Announcement none → “Maintenance” · Pause packet readers: on"
	if last["summary"] != summary || last["actorEmail"] != "operator@test.invalid" {
		t.Fatalf("last change %v", saved["lastChange"])
	}
	out, entries := auditLog(t, app, operator, "")
	if len(entries) != 1 || out["more"] != false || out["keptDays"] != float64(365) {
		t.Fatalf("log %v", out)
	}
	e := entries[0]
	if e["kind"] != "settings" || e["via"] != "odyle" || e["actor"] != operator.Id || e["actorEmail"] != "operator@test.invalid" || e["summary"] != summary {
		t.Fatalf("entry %v", e)
	}
	changes := e["details"].(map[string]any)["changes"].([]any)
	if len(changes) != 3 || asJSON(t, changes[0]) != `{"after":45,"before":40,"field":"odylePerCube","label":"Odyle per cube"}` {
		t.Fatalf("changes %v", changes)
	}
	if actors := out["actors"].([]any); len(actors) != 1 || actors[0].(map[string]any)["id"] != operator.Id || actors[0].(map[string]any)["email"] != "operator@test.invalid" {
		t.Fatalf("actors %v", actors)
	}

	// Nothing changed, or refused: nothing recorded, and nothing saved.
	ask(t, app, http.MethodPost, "/api/odyle/admin/settings", tokenOf(t, operator), `{"odylePerCube":45,"readerPaused":true}`, 200)
	ask(t, app, http.MethodPost, "/api/odyle/admin/settings", tokenOf(t, operator), `{"odylePerCube":50,"weeklyResetDay":"someday"}`, 400)
	if _, entries := auditLog(t, app, operator, ""); len(entries) != 1 {
		t.Fatalf("%d entries", len(entries))
	}
	if got := readSettings(app).OdylePerCube; got != 45 {
		t.Fatalf("a refused save changed Odyle per cube to %d", got)
	}
}

// Superusers who edit odyle_settings under Collections are recorded too; the log itself
// cannot be added to, changed or deleted through the API, and its collection stays.
func TestCollectionsEditsAreAuditedAndTheLogCannotBeChanged(t *testing.T) {
	app := newTestApp(t)
	operator := newOperator(t, app)
	admin := tokenOf(t, operator)
	id := findSettings(app).Id
	ask(t, app, http.MethodPatch, "/api/collections/odyle_settings/records/"+id, admin, `{"odylePerCube":55,"pairingPaused":true}`, 200)
	_, entries := auditLog(t, app, operator, "")
	if len(entries) != 1 || entries[0]["via"] != "collections" || entries[0]["summary"] != "Odyle per cube 40 → 55 · Pause new pairings: on" || entries[0]["actor"] != operator.Id {
		t.Fatalf("entries %v", entries)
	}
	scenario := func(method, url, body string, status int) {
		t.Helper()
		s := tests.ApiScenario{Name: method + " " + url, Method: method, URL: url, Headers: admin, ExpectedStatus: status, ExpectedContent: []string{""},
			TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true}
		if body != "" {
			s.Body = strings.NewReader(body)
		}
		s.Test(t)
	}
	// Deleting the record brings the defaults back, recorded as the change it makes.
	scenario(http.MethodDelete, "/api/collections/odyle_settings/records/"+id, "", 204)
	_, entries = auditLog(t, app, operator, "")
	if len(entries) != 2 || entries[0]["summary"] != "Odyle per cube 55 → 40 · Pause new pairings: off" {
		t.Fatalf("after deleting %v", entries[0])
	}

	entry := entries[0]["id"].(string)
	scenario(http.MethodPost, "/api/collections/odyle_audit/records", `{"kind":"settings","summary":"forged"}`, 403)
	scenario(http.MethodPatch, "/api/collections/odyle_audit/records/"+entry, `{"summary":"rewritten"}`, 403)
	scenario(http.MethodDelete, "/api/collections/odyle_audit/records/"+entry, "", 403)
	scenario(http.MethodDelete, "/api/collections/odyle_audit", "", 400)
	scenario(http.MethodPatch, "/api/collections/odyle_audit", `{"listRule":""}`, 400)
	if _, entries := auditLog(t, app, operator, ""); len(entries) != 2 || entries[0]["summary"] != "Odyle per cube 55 → 40 · Pause new pairings: off" {
		t.Fatalf("the log changed: %v", entries)
	}
}

// Jobs run by hand, Update all apps now and vacuums are recorded, and the log filters by
// kind, superuser and words.
func TestJobRunsUpdatesAndVacuumsAreAudited(t *testing.T) {
	app := newTestApp(t)
	operator := newOperator(t, app)
	admin := tokenOf(t, operator)
	ask(t, app, http.MethodPost, "/api/odyle/admin/jobs/odyle-expiry", admin, "", 200)
	ask(t, app, http.MethodPost, "/api/odyle/admin/update-apps", admin, "", 200)
	ask(t, app, http.MethodPost, "/api/odyle/admin/vacuum/logs", admin, "", 200)
	// Refused before it ran: nothing to record.
	ask(t, app, http.MethodPost, "/api/odyle/admin/jobs/odyle-retention", admin, "", 400)
	_, entries := auditLog(t, app, operator, "")
	kinds := []string{}
	for _, e := range entries {
		kinds = append(kinds, e["kind"].(string))
	}
	if !slices.Equal(kinds, []string{"vacuum", "update-apps", "job"}) {
		t.Fatalf("kinds %v", kinds)
	}
	if s := entries[2]["summary"]; s != "Ran odyle-expiry by hand: 0 done" {
		t.Fatalf("job %v", s)
	}
	if d := entries[2]["details"].(map[string]any); d["job"] != "odyle-expiry" || d["done"] != float64(0) {
		t.Fatalf("job details %v", d)
	}
	if s := entries[1]["summary"]; s != "Asked every running Windows app to update now to the newest release they find: 0 connections told" {
		t.Fatalf("update %v", s)
	}
	if s := entries[0]["summary"].(string); !strings.HasPrefix(s, "Vacuumed auxiliary.db: ") || !strings.Contains(s, " MB → ") {
		t.Fatalf("vacuum %v", s)
	}
	for query, want := range map[string]int{"?kind=job": 1, "?kind=settings": 0, "?actor=" + operator.Id: 3, "?actor=someone": 0, "?q=VACUUMED": 1, "?q=odyle-expiry+hand": 1, "?q=" + url.QueryEscape("%"): 0, "?q=" + url.QueryEscape("_"): 0} {
		if _, found := auditLog(t, app, operator, query); len(found) != want {
			t.Errorf("%s: %d entries, want %d", query, len(found), want)
		}
	}
}

// The log answers 50 entries at a time, newest first, and continues after the last one shown,
// entries of the same millisecond included; the expiry job deletes entries older than a year.
func TestAuditPagesAndExpiry(t *testing.T) {
	app := newTestApp(t)
	operator := newOperator(t, app)
	for i := range 120 {
		if err := audit(app, operator, auditJob, viaOdyle, fmt.Sprintf("entry %03d", i), map[string]any{}); err != nil {
			t.Fatal(err)
		}
	}
	seen, times, query := map[string]bool{}, []string{}, ""
	for page := 0; ; page++ {
		out, entries := auditLog(t, app, operator, query)
		for _, e := range entries {
			seen[e["summary"].(string)] = true
			times = append(times, e["created"].(string))
		}
		if out["more"] == false {
			if page != 2 || len(entries) != 20 {
				t.Fatalf("page %d with %d entries", page, len(entries))
			}
			break
		}
		last := entries[len(entries)-1]
		query = "?before=" + url.QueryEscape(last["created"].(string)) + "&beforeId=" + last["id"].(string)
	}
	if len(times) != 120 || len(seen) != 120 || !slices.IsSortedFunc(times, func(a, b string) int { return strings.Compare(b, a) }) {
		t.Fatalf("%d entries, %d different, newest first: %v", len(times), len(seen), slices.IsSortedFunc(times, func(a, b string) int { return strings.Compare(b, a) }))
	}

	old := saved(t, app, "odyle_audit", map[string]any{"kind": auditJob, "summary": "a year and a day ago"})
	if _, err := app.DB().NewQuery("UPDATE odyle_audit SET created = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": stamp(time.Now().Add(-366 * 24 * time.Hour)), "id": old.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	if _, err := cleanup(app); err != nil {
		t.Fatal(err)
	}
	if n := countOf(t, app, "odyle_audit"); n != 120 {
		t.Fatalf("%d entries kept", n)
	}
}

// A scheduled announcement: validated, kept to the minute in UTC, shown only inside its
// schedule, and told to every client when a save changes what shows now or, through the
// odyle-announcement job, when its start or end passes.
func TestScheduledAnnouncements(t *testing.T) {
	app := newTestApp(t)
	lead := newUser(t, app, "Lead")
	for _, bad := range []body{{"announcementFrom": "tomorrow"}, {"announcementFrom": float64(5)}, {"announcementUntil": "1999-12-31T10:00:00Z"},
		{"announcementFrom": "2026-11-05T10:00Z", "announcementUntil": "2026-11-05T10:00:30Z"}, {"announcementFrom": "2026-11-05T12:00Z", "announcementUntil": "2026-11-05T10:00Z"}} {
		if _, err := writeSettings(app, bad); err == nil {
			t.Errorf("accepted %v", bad)
		}
	}
	s, err := writeSettings(app, body{"announcement": "Maintenance", "announcementFrom": "2026-11-05T10:00:30+01:00", "announcementUntil": " 2026-11-05 12:00Z "})
	if err != nil || s.AnnouncementFrom != "2026-11-05T09:00:00.000Z" || s.AnnouncementUntil != "2026-11-05T12:00:00.000Z" {
		t.Fatalf("saved %q to %q, %v", s.AnnouncementFrom, s.AnnouncementUntil, err)
	}
	at := func(v string) time.Time { t, _ := time.Parse(time.RFC3339, v); return t }
	for moment, shown := range map[string]bool{"2026-11-05T08:59:59Z": false, "2026-11-05T09:00:00Z": true, "2026-11-05T11:59:59Z": true, "2026-11-05T12:00:00Z": false} {
		if got := announcementAt(s, at(moment)) != nil; got != shown {
			t.Errorf("at %s shown %v", moment, got)
		}
	}
	// No start or end is no limit; null clears them too.
	if s, err = writeSettings(app, body{"announcementFrom": "", "announcementUntil": nil}); err != nil || s.AnnouncementFrom != "" || s.AnnouncementUntil != "" || announcement(s) == nil {
		t.Fatalf("cleared %+v, %v", s, err)
	}

	l := listen(t, app, lead, userTopic+lead.Id)
	heard := func(want any) {
		t.Helper()
		_, data, ok := l.next()
		if got, has := data["announcement"]; !ok || !has || !sameJSON(got, want) {
			t.Fatalf("heard %v, want %v", data, want)
		}
	}
	shown := map[string]any{"text": "Maintenance", "level": "info"}
	// Scheduled for later: it does not show yet, and saying so is news.
	later := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	if _, err := writeSettings(app, body{"announcementFrom": later}); err != nil {
		t.Fatal(err)
	}
	heard(nil)
	if got := ask(t, app, http.MethodGet, "/api/odyle/announcement", nil, "", 200)["announcement"]; got != nil {
		t.Fatalf("shown before its start: %v", got)
	}
	// Its text changed while it waits: nothing shows, so nobody hears of it.
	if _, err := writeSettings(app, body{"announcement": "Maintenance", "announcementLevel": "warning"}); err != nil {
		t.Fatal(err)
	}
	l.quiet()
	shown["level"] = "warning"

	// Its start passes: the job tells everyone once, then nothing more.
	state := stateOf(app)
	start := time.Now().Truncate(time.Minute)
	record := findSettings(app)
	record.Set("announcementFrom", iso(start))
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	heard(shown)
	state.announcementCheckedAt = start.Add(-time.Second)
	if out, err := announcementSchedule(app); err != nil || out.Done != 1 {
		t.Fatalf("start %+v %v", out, err)
	}
	heard(shown)
	if out, _ := announcementSchedule(app); out.Done != 0 {
		t.Fatalf("told twice: %+v", out)
	}
	l.quiet()
	if got := ask(t, app, http.MethodGet, "/api/odyle/announcement", nil, "", 200)["announcement"]; !sameJSON(got, shown) {
		t.Fatalf("shown %v", got)
	}

	// Its end passes, also when it ended within the minute before the server started.
	record = findSettings(app)
	record.Set("announcementFrom", iso(start.Add(-time.Hour)))
	record.Set("announcementUntil", iso(time.Now().Add(-time.Second)))
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	heard(nil)
	state.announcementCheckedAt = time.Time{}
	if out, err := announcementSchedule(app); err != nil || out.Done != 1 {
		t.Fatalf("end %+v %v", out, err)
	}
	heard(nil)
	if got := ask(t, app, http.MethodGet, "/api/odyle/announcement", nil, "", 200)["announcement"]; got != nil {
		t.Fatalf("shown after its end: %v", got)
	}
}

// The migration adds the audit log and the schedule, and reverting it removes both, the log's
// system collection included.
func TestTheAuditMigrationRevertsCleanly(t *testing.T) {
	app := newTestApp(t)
	var migration *core.Migration
	for _, m := range core.AppMigrations.Items() {
		if m.File == "1791763268_audit_log.go" {
			migration = m
		}
	}
	if migration == nil {
		t.Fatal("the migration is not registered")
	}
	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("odyle_audit"); err == nil {
		t.Fatal("the log stayed")
	}
	if settings, _ := app.FindCollectionByNameOrId("odyle_settings"); settings.Fields.GetByName("announcementFrom") != nil {
		t.Fatal("the schedule stayed")
	}
	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	audit, err := app.FindCollectionByNameOrId("odyle_audit")
	if err != nil || !audit.System || audit.ListRule != nil {
		t.Fatalf("log %+v, %v", audit, err)
	}
}
