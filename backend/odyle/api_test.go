package odyle

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// Routes over HTTP in the test process (PocketBase's tests.ApiScenario), next to the
// integration tests that drive the built backend.
func TestRoutesOverHTTP(t *testing.T) {
	app := newTestApp(t)
	lead, mate, outsider := newUser(t, app, "Lead"), newUser(t, app, "Mate"), newUser(t, app, "Outsider")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	session := saved(t, app, "publisher_sessions", map[string]any{"user": mate.Id, "expiresAt": expiry(86400)})
	shared := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Shared", "server": "Lumiel", "region": "GLOBAL_EU", "readingSession": session.Id})
	saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Hidden", "server": "Lumiel", "region": "GLOBAL_EU"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter", "sharedCharacters": []string{shared.Id}})
	token := func(user *core.Record) map[string]string {
		raw, err := user.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		return map[string]string{"Authorization": raw}
	}
	reuse := func(testing.TB) *tests.TestApp { return app }
	scenarios := []tests.ApiScenario{
		{Name: "a room is for its members", Method: http.MethodGet, URL: "/api/odyle/snapshot/" + room.Id, Headers: token(outsider),
			ExpectedStatus: 403, ExpectedContent: []string{"You are not a member of this room."}},
		{Name: "members see what others share, and nothing else", Method: http.MethodGet, URL: "/api/odyle/snapshot/" + room.Id, Headers: token(lead),
			ExpectedStatus: 200, ExpectedContent: []string{`"characterName":"Shared"`, `"shared":true`}, NotExpectedContent: []string{"Hidden", "readingSession"}},
		{Name: "a heartbeat needs the account's own session", Method: http.MethodPost, URL: "/api/odyle/heartbeat", Headers: token(outsider),
			Body: strings.NewReader(`{"sessionId":"` + session.Id + `","characterId":"` + shared.Id + `"}`), ExpectedStatus: 403, ExpectedContent: []string{"Publisher session expired. Reconnect."}},
		{Name: "a heartbeat is kept in memory and answered at once", Method: http.MethodPost, URL: "/api/odyle/heartbeat", Headers: token(mate),
			Body: strings.NewReader(`{"sessionId":"` + session.Id + `","characterId":"` + shared.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"serverNow":`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				c, _ := findAs[Character](app, "characters", shared.Id)
				if at, ok := seenAt(app, c); !ok || time.Since(at) > time.Minute {
					t.Fatal("the heartbeat was not kept")
				}
			}},
		{Name: "manual readings are refused", Method: http.MethodPost, URL: "/api/odyle/report", Headers: token(mate),
			Body:           strings.NewReader(`{"sessionId":"` + session.Id + `","sequence":1,"characterName":"Shared","server":"Lumiel","region":"GLOBAL_EU","value":5,"source":"manual","parserVersion":"test-fixture-v1","confirmed":true}`),
			ExpectedStatus: 400, ExpectedContent: []string{"Odyle must come from game packets. Manual readings are disabled."}},
		{Name: "Go profiles are for superusers", Method: http.MethodGet, URL: "/api/odyle/admin/pprof/heap", Headers: token(lead), ExpectedStatus: 403, ExpectedContent: []string{`"status":403`}},
	}
	for _, s := range scenarios {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
}

// Packet readers paused under Server controls: apps hear of it from rooms, sessions and
// heartbeats, readings are refused with 503 and the rest keeps working.
func TestPausedReadersAreToldAndTheirReadingsRefused(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	reader := newUser(t, app, "Reader")
	session := saved(t, app, "publisher_sessions", map[string]any{"user": reader.Id, "expiresAt": expiry(86400)})
	character := saved(t, app, "characters", map[string]any{"user": reader.Id, "characterName": "Paused", "server": "Lumiel", "region": "GLOBAL_EU", "readingSession": session.Id, "value": 100, "confirmed": true, "valid": true})
	raw, err := reader.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	auth := map[string]string{"Authorization": raw}
	reading := func(sequence int) *strings.Reader {
		return strings.NewReader(`{"sessionId":"` + session.Id + `","sequence":` + strconv.Itoa(sequence) + `,"characterId":"` + character.Id + `","characterName":"Paused","server":"Lumiel","region":"GLOBAL_EU","value":140,"source":"packet","parserVersion":"global-reference-v2","confirmed":true}`)
	}
	pause := func(paused bool) func(testing.TB, *tests.TestApp, *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			if _, err := writeSettings(app, body{"readerPaused": paused}); err != nil {
				t.Fatal(err)
			}
		}
	}
	reuse := func(testing.TB) *tests.TestApp { return app }
	scenarios := []tests.ApiScenario{
		{Name: "rooms tell the app", Method: http.MethodGet, URL: "/api/odyle/rooms", Headers: auth, BeforeTestFunc: pause(true),
			ExpectedStatus: 200, ExpectedContent: []string{`"readerPaused":true`}},
		{Name: "a new session tells the app", Method: http.MethodPost, URL: "/api/odyle/session", Headers: auth, Body: strings.NewReader(`{}`),
			ExpectedStatus: 200, ExpectedContent: []string{`"sessionId":`, `"readerPaused":true`}},
		{Name: "heartbeats keep working and tell the app", Method: http.MethodPost, URL: "/api/odyle/heartbeat", Headers: auth,
			Body: strings.NewReader(`{"sessionId":"` + session.Id + `","characterId":"` + character.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"serverNow":`, `"readerPaused":true`}},
		{Name: "readings are refused", Method: http.MethodPost, URL: "/api/odyle/report", Headers: auth, Body: reading(1),
			ExpectedStatus: 503, ExpectedContent: []string{`"message":"Packet readers are paused by the server operators."`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if c, _ := findAs[Character](app, "characters", character.Id); c.Value() != 100 || countOf(t, app, "character_readings") != 0 {
					t.Fatalf("a paused reading was saved: %d", c.Value())
				}
			}},
		{Name: "a stale mark still works", Method: http.MethodPost, URL: "/api/odyle/invalidate", Headers: auth,
			Body: strings.NewReader(`{"sessionId":"` + session.Id + `","characterId":"` + character.Id + `"}`), ExpectedStatus: 200, ExpectedContent: []string{`"success":true`}},
		{Name: "once resumed, the next reading is saved with its adapter", Method: http.MethodPost, URL: "/api/odyle/report", Headers: auth, Body: reading(1), BeforeTestFunc: pause(false),
			ExpectedStatus: 200, ExpectedContent: []string{`"value":140`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				points, err := allAs[HistoryPoint](app, "character_readings", "character = {:id}", dbx.Params{"id": character.Id})
				if err != nil || len(points) != 1 || points[0].Adapter() != "global-reference-v2" {
					t.Fatalf("history after the reading: %v", err)
				}
			}},
		{Name: "rooms tell the app it may read again", Method: http.MethodGet, URL: "/api/odyle/rooms", Headers: auth,
			ExpectedStatus: 200, ExpectedContent: []string{`"readerPaused":false`}},
	}
	for _, s := range scenarios {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
}
