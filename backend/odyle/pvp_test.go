package odyle

import (
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// findRaw is a character's stored PvP counts as JSON.
func findRaw(t *testing.T, app *tests.TestApp, id string) string {
	t.Helper()
	record, err := app.FindRecordById("characters", id)
	if err != nil {
		t.Fatal(err)
	}
	return record.GetString("pvp")
}

func pvpEventJSON(id, kind, name, rest string) string {
	return `{"id":"` + id + `","kind":"` + kind + `","name":"` + name + `"` + rest + `}`
}

// PvP events are kept only for accounts that turned PvP stats on, once each, reach the rooms
// with the character, and disappear when PvP stats are turned off.
func TestPvpStatsAreOptInAndForgottenWhenTurnedOff(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player, mate, other := newUser(t, app, "Fighter"), newUser(t, app, "Mate"), newUser(t, app, "Stranger")
	session := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	theirSession := saved(t, app, "publisher_sessions", map[string]any{"user": other.Id, "expiresAt": expiry(86400)})
	c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Hero", "server": "Lumiel", "region": "GLOBAL_EU"})
	hidden := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Alt", "server": "Lumiel", "region": "GLOBAL_EU"})
	room := saved(t, app, "party_rooms", map[string]any{"owner": player.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "owner", "sharedCharacters": []string{c.Id}})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	token := func(user interface{ NewAuthToken() (string, error) }) map[string]string {
		raw, err := user.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		return map[string]string{"Authorization": raw}
	}
	auth, mates, theirs := token(player), token(mate), token(other)
	reuse := func(testing.TB) *tests.TestApp { return app }
	id := func(n int) string { return strings.Repeat("0", 31) + string(rune('a'+n)) }
	send := func(sessionId, characterId string, events ...string) *strings.Reader {
		return strings.NewReader(`{"sessionId":"` + sessionId + `","characterId":"` + characterId + `","adapter":"global-pvp-v1","events":[` + strings.Join(events, ",") + `]}`)
	}
	kill := pvpEventJSON(id(0), "kill", "Vexa", `,"server":"","region":"","ago":5`)
	scenarios := func(list ...tests.ApiScenario) {
		for _, s := range list {
			s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
			s.Test(t)
		}
	}
	post := func(name string, headers map[string]string, body *strings.Reader, status int, content ...string) tests.ApiScenario {
		return tests.ApiScenario{Name: name, Method: http.MethodPost, URL: "/api/odyle/pvp", Headers: headers, Body: body, ExpectedStatus: status, ExpectedContent: content}
	}
	scenarios(
		post("not turned on yet: nothing kept", auth, send(session.Id, c.Id, kill), 200, `"enabled":false`),
		tests.ApiScenario{Name: "the heartbeat says it is off", Method: http.MethodPost, URL: "/api/odyle/heartbeat", Headers: auth, Body: strings.NewReader(`{"sessionId":"` + session.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"pvpStats":false`}},
		tests.ApiScenario{Name: "no stats while off", Method: http.MethodGet, URL: "/api/odyle/pvp/" + c.Id, Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"enabled":false`, `"opponents":[]`, `"events":[]`, `"allTime":null`}},
		tests.ApiScenario{Name: "the switch takes true or false", Method: http.MethodPost, URL: "/api/odyle/pvp-stats", Headers: auth, Body: strings.NewReader(`{"enabled":1}`), ExpectedStatus: 400, ExpectedContent: []string{"PvP stats must be true or false."}},
		tests.ApiScenario{Name: "the owner turns it on", Method: http.MethodPost, URL: "/api/odyle/pvp-stats", Headers: auth, Body: strings.NewReader(`{"enabled":true}`), ExpectedStatus: 200, ExpectedContent: []string{`"pvpStats":true`}},
		tests.ApiScenario{Name: "the heartbeat says it is on", Method: http.MethodPost, URL: "/api/odyle/heartbeat", Headers: auth, Body: strings.NewReader(`{"sessionId":"` + session.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"pvpStats":true`}},
		tests.ApiScenario{Name: "a new session says it is on", Method: http.MethodPost, URL: "/api/odyle/session", Headers: auth, Body: strings.NewReader(`{}`), ExpectedStatus: 200, ExpectedContent: []string{`"pvpStats":true`}},
		tests.ApiScenario{Name: "the account answer says it is on", Method: http.MethodGet, URL: "/api/odyle/account", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"pvpStats":true`, `"pvpDays":90`}},
		post("another account's character", theirs, send(theirSession.Id, c.Id, kill), 403, "This character belongs to another account."),
		post("an unknown adapter", auth, strings.NewReader(`{"sessionId":"`+session.Id+`","characterId":"`+c.Id+`","adapter":"global-pvp-v0","events":[`+kill+`]}`), 400, "This PvP adapter is not accepted."),
		post("no events", auth, send(session.Id, c.Id), 400, "Send 1 to 20 PvP events."),
		post("too many events", auth, send(session.Id, c.Id, slices.Repeat([]string{kill}, 21)...), 400, "Send 1 to 20 PvP events."),
		post("an id twice", auth, send(session.Id, c.Id, kill, kill), 400, "A PvP event's id is 32 hexadecimal digits, each once."),
		post("an id of another shape", auth, send(session.Id, c.Id, pvpEventJSON("abc", "kill", "Vexa", `,"ago":0`)), 400, "A PvP event's id is 32 hexadecimal digits"),
		post("an unknown kind", auth, send(session.Id, c.Id, pvpEventJSON(id(1), "duel", "Vexa", `,"ago":0`)), 400, "A PvP event is a kill, an assist or a death."),
		post("a name with markup", auth, send(session.Id, c.Id, pvpEventJSON(id(1), "kill", "<b>Vexa</b>", `,"ago":0`)), 400, "A player's name is 1 to 40 letters or digits."),
		post("a server without its region", auth, send(session.Id, c.Id, pvpEventJSON(id(1), "kill", "Vexa", `,"server":"Kaisinel","ago":0`)), 400, "A player's server comes with its Global region"),
		post("an unknown region", auth, send(session.Id, c.Id, pvpEventJSON(id(1), "kill", "Vexa", `,"server":"Kaisinel","region":"KOREA","ago":0`)), 400, "A player's server comes with its Global region"),
		post("an event of last week", auth, send(session.Id, c.Id, pvpEventJSON(id(1), "kill", "Vexa", `,"ago":604800`)), 400, "A PvP event's age in seconds must be an integer"),
		post("a killer of an assist with markup", auth, send(session.Id, c.Id, pvpEventJSON(id(1), "assist", "Vexa", `,"by":"Ka el","ago":0`)), 400, "A player's name is 1 to 40 letters or digits."),
		post("a kill, an assist and a death are kept", auth, send(session.Id, c.Id, kill,
			pvpEventJSON(id(1), "assist", "Nyra", `,"server":"Kaisinel","region":"GLOBAL_EU","by":"Kael","byServer":"Lumiel","byRegion":"GLOBAL_EU","ago":60`),
			pvpEventJSON(id(2), "death", "Vexa", `,"server":"Kaisinel","region":"GLOBAL_EU","ago":0`)), 200, `"enabled":true`, `"stored":3`),
		post("the same events again are stored once", auth, send(session.Id, c.Id, kill, pvpEventJSON(id(3), "death", "Šárka", `,"ago":1,"by":"Ignored"`)), 200, `"stored":1`),
	)
	if n := countOf(t, app, "character_pvp"); n != 4 {
		t.Fatalf("kept %d events, want 4", n)
	}
	counts := func(id string) pvpCounts {
		t.Helper()
		record, err := findAs[Character](app, "characters", id)
		if err != nil {
			t.Fatal(err)
		}
		return pvpCountsOf(record)
	}
	if got := counts(hidden.Id); got != (pvpCounts{}) || !strings.Contains(findRaw(t, app, hidden.Id), `"kills":0`) {
		t.Fatalf("a character without events counts %+v, want zeros", got)
	}
	if got := counts(c.Id); got.Kills != 1 || got.Assists != 1 || got.Deaths != 2 || got.At == "" {
		t.Fatalf("counts = %+v, want 1 kill, 1 assist, 2 deaths", got)
	}
	if row, err := app.FindFirstRecordByFilter("character_pvp", "event = {:id}", dbx.Params{"id": id(3)}); err != nil || row.GetString("killer") != "" {
		t.Fatalf("a death kept a killer: %v, %v", row, err)
	}
	// The owner and the room the character is shared in read the stats; the room does not read
	// a character it is not shared in, and a stranger reads neither.
	scenarios(
		tests.ApiScenario{Name: "the owner reads the stats", Method: http.MethodGet, URL: "/api/odyle/pvp/" + c.Id, Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"enabled":true`, `"days":90`, `"keepDays":90`, `"totals":{"kills":1,"assists":1,"deaths":2}`, `"allTime":{"kills":1,"assists":1,"deaths":2,"at":"`,
			// Vexa without a server is the Vexa of Kaisinel: one row.
			`"opponents":[{"name":"Vexa","server":"Kaisinel","region":"GLOBAL_EU","kills":1,"assists":0,"deaths":1,"lastAt":"`, `{"name":"Nyra","server":"Kaisinel","region":"GLOBAL_EU","kills":0,"assists":1,"deaths":0,`, `{"name":"Šárka","server":"","region":"","kills":0,"assists":0,"deaths":1,`, `"opponentCount":3`,
			`"allies":[{"name":"Kael","server":"Lumiel","region":"GLOBAL_EU","kills":0,"assists":1,"deaths":0,`, `"total":4`, `"by":"Kael"`, `"byServer":"Lumiel"`, `"byRegion":"GLOBAL_EU"`}},
		tests.ApiScenario{Name: "a room member reads them", Method: http.MethodGet, URL: "/api/odyle/pvp/" + c.Id, Headers: mates, ExpectedStatus: 200, ExpectedContent: []string{`"enabled":true`, `"opponentCount":3`}},
		tests.ApiScenario{Name: "but not of a character hidden from the room", Method: http.MethodGet, URL: "/api/odyle/pvp/" + hidden.Id, Headers: mates, ExpectedStatus: 403, ExpectedContent: []string{"This character is not shared with you."}},
		tests.ApiScenario{Name: "a stranger cannot", Method: http.MethodGet, URL: "/api/odyle/pvp/" + c.Id, Headers: theirs, ExpectedStatus: 403, ExpectedContent: []string{"This character is not shared with you."}},
		tests.ApiScenario{Name: "a page of the events alone", Method: http.MethodGet, URL: "/api/odyle/pvp/" + c.Id + "?only=events&page=2&perPage=3", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"page":2`, `"pages":2`, `"total":4`, `"kind":"assist"`}, NotExpectedContent: []string{`"opponents"`, `"kind":"kill"`}},
		tests.ApiScenario{Name: "the room snapshot carries the counts", Method: http.MethodGet, URL: "/api/odyle/snapshot/" + room.Id, Headers: mates, ExpectedStatus: 200, ExpectedContent: []string{`"pvp":{"kills":1,"assists":1,"deaths":2,"at":"`}},
		tests.ApiScenario{Name: "the export lists the events", Method: http.MethodGet, URL: "/api/odyle/export", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"pvpEvents":[{`, `"name":"Šárka"`, `"pvpEvents":[]`}},
	)
	// A period: a death moved 40 days back is outside the last 30 days and inside the 90 kept.
	if _, err := app.DB().NewQuery("UPDATE character_pvp SET at = {:at} WHERE event = {:id}").Bind(dbx.Params{"at": stamp(time.Now().Add(-40 * 24 * time.Hour)), "id": id(2)}).Execute(); err != nil {
		t.Fatal(err)
	}
	scenarios(
		tests.ApiScenario{Name: "the last 30 days", Method: http.MethodGet, URL: "/api/odyle/pvp/" + c.Id + "?days=30", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"days":30`, `"totals":{"kills":1,"assists":1,"deaths":1}`, `{"name":"Vexa","server":"","region":"","kills":1,"assists":0,"deaths":0,`, `"total":3`}},
		tests.ApiScenario{Name: "a period longer than events are kept", Method: http.MethodGet, URL: "/api/odyle/pvp/" + c.Id + "?days=400", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"days":90`, `"totals":{"kills":1,"assists":1,"deaths":2}`}},
	)
	// Server controls switch the adapter off like a reading adapter.
	if _, err := writeSettings(app, body{"adapters": map[string]any{"extra": []any{}, "disabled": []any{"global-pvp-v1"}}}); err != nil {
		t.Fatal(err)
	}
	scenarios(post("a switched-off adapter", auth, send(session.Id, c.Id, kill), 400, "This PvP adapter is not accepted."))
	if _, err := writeSettings(app, body{"adapters": map[string]any{"extra": []any{}, "disabled": []any{}}, "readerPaused": true}); err != nil {
		t.Fatal(err)
	}
	scenarios(post("paused readers", auth, send(session.Id, c.Id, kill), 503, "Packet readers are paused"))
	if _, err := writeSettings(app, body{"readerPaused": false}); err != nil {
		t.Fatal(err)
	}
	scenarios(
		tests.ApiScenario{Name: "the owner turns it off", Method: http.MethodPost, URL: "/api/odyle/pvp-stats", Headers: auth, Body: strings.NewReader(`{"enabled":false}`), ExpectedStatus: 200, ExpectedContent: []string{`"pvpStats":false`}},
		tests.ApiScenario{Name: "nothing is left", Method: http.MethodGet, URL: "/api/odyle/pvp/" + c.Id, Headers: mates, ExpectedStatus: 200, ExpectedContent: []string{`"enabled":false`, `"opponents":[]`, `"events":[]`, `"total":0`}},
	)
	if got := counts(c.Id); got != (pvpCounts{}) || findRaw(t, app, c.Id) != "null" && findRaw(t, app, c.Id) != "" {
		t.Fatalf("counts after turning PvP stats off = %+v (%s), want none", got, findRaw(t, app, c.Id))
	}
	if n := countOf(t, app, "character_pvp"); n != 0 {
		t.Fatalf("%d events left after turning PvP stats off", n)
	}
}

// The expiry job deletes PvP events older than Game settings keep them, and a deleted
// character takes its events with it.
func TestOldPvpEventsExpire(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Fighter")
	c := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Hero", "server": "Lumiel", "region": "GLOBAL_EU"})
	event := func(id string, days int) {
		saved(t, app, "character_pvp", map[string]any{"character": c.Id, "event": id, "kind": "kill", "name": "Vexa", "at": stamp(time.Now().Add(-time.Duration(days) * 24 * time.Hour))})
	}
	event(strings.Repeat("a", 32), 91)
	event(strings.Repeat("b", 32), 20)
	event(strings.Repeat("c", 32), 2)
	if s := readSettings(app); s.PvpDays != 90 {
		t.Fatalf("PvP events are kept %d days by default, want 90", s.PvpDays)
	}
	if _, err := cleanup(app); err != nil {
		t.Fatal(err)
	}
	if n := countOf(t, app, "character_pvp"); n != 2 {
		t.Fatalf("%d events after the expiry job, want 2", n)
	}
	for _, bad := range []body{{"pvpDays": float64(0)}, {"pvpDays": float64(3651)}, {"pvpDays": 7.5}} {
		if _, err := writeSettings(app, bad); err == nil {
			t.Errorf("writeSettings(%v) accepted", bad)
		}
	}
	if s, err := writeSettings(app, body{"pvpDays": float64(7)}); err != nil || s.PvpDays != 7 || readSettings(app).PvpDays != 7 {
		t.Fatalf("saved %d days: %v", s.PvpDays, err)
	}
	if _, err := cleanup(app); err != nil {
		t.Fatal(err)
	}
	if n := countOf(t, app, "character_pvp"); n != 1 {
		t.Fatalf("%d events kept for 7 days, want 1", n)
	}
	record, err := app.FindRecordById("characters", c.Id)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(record); err != nil {
		t.Fatal(err)
	}
	if n := countOf(t, app, "character_pvp"); n != 0 {
		t.Fatalf("%d events left of a deleted character", n)
	}
}

// One player the game named with and without a server is one row; two servers stay apart.
func TestPvpPlayersMergeByName(t *testing.T) {
	rows := mergePlayers([]pvpPlayerRow{
		{Name: "Vexa", Kills: 2, Last: "2026-11-10"}, {Name: "Vexa", Server: "Kaisinel", Region: "GLOBAL_EU", Deaths: 1, Last: "2026-11-12"},
		{Name: "Nyra", Assists: 1, Last: "2026-11-11"}, {Name: "Twin", Server: "Siel", Region: "GLOBAL_EU", Kills: 1, Last: "2026-11-09"}, {Name: "Twin", Server: "Ariel", Region: "GLOBAL_EU", Kills: 1, Last: "2026-11-08"}, {Name: "Twin", Deaths: 5, Last: "2026-11-07"},
	})
	want := []pvpPlayerRow{
		{Name: "Twin", Deaths: 5, Last: "2026-11-07"}, {Name: "Vexa", Server: "Kaisinel", Region: "GLOBAL_EU", Kills: 2, Deaths: 1, Last: "2026-11-12"},
		{Name: "Nyra", Assists: 1, Last: "2026-11-11"}, {Name: "Twin", Server: "Siel", Region: "GLOBAL_EU", Kills: 1, Last: "2026-11-09"}, {Name: "Twin", Server: "Ariel", Region: "GLOBAL_EU", Kills: 1, Last: "2026-11-08"},
	}
	if !slices.Equal(rows, want) {
		t.Fatalf("merged = %+v\nwant %+v", rows, want)
	}
	if got := mergePlayers(nil); got == nil || len(got) != 0 {
		t.Fatalf("no rows merge to %v, want an empty list", got)
	}
}
