package odyle

import (
	"net/http"
	"strings"
	"testing"
	"time"

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
				c, _ := app.FindRecordById("characters", shared.Id)
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
