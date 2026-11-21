package odyle

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// Runs outside Odyle (#35): a run's event link (https only), and the private calendar feed of the
// runs an account goes to, behind a token whose digest alone is kept; a new address ends the old.
func TestRunsReachCalendarsAndEventLinks(t *testing.T) {
	app := newTestApp(t)
	lead, mate := newUser(t, app, "Lead"), newUser(t, app, "Mate")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid, night", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	auth, in := tokenOf(t, lead), `"roomId":"`+room.Id+`"`
	start := time.Now().Add(3 * time.Hour).UTC().Format(time.RFC3339)
	ask(t, app, http.MethodPost, "/api/odyle/plan", auth, `{`+in+`,"dungeon":"Fire Temple","startsAt":"`+start+`","note":"secret note","link":"http://example.com"}`, 400)
	got := ask(t, app, http.MethodPost, "/api/odyle/plan", auth, `{`+in+`,"dungeon":"Fire Temple","startsAt":"`+start+`","note":"secret note","link":"https://raid-helper.dev/event/1"}`, 200)
	run := got["runs"].([]any)[0].(map[string]any)
	if run["link"] != "https://raid-helper.dev/event/1" {
		t.Fatalf("link %v", run["link"])
	}
	if edited := ask(t, app, http.MethodPost, "/api/odyle/plan", auth, `{`+in+`,"id":"`+run["id"].(string)+`","link":""}`, 200)["runs"].([]any)[0].(map[string]any); edited["link"] != "" {
		t.Fatalf("link removed: %v", edited["link"])
	}
	ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, mate), `{`+in+`,"dungeon":"Ice Temple","startsAt":"`+start+`"}`, 200)

	made := ask(t, app, http.MethodPost, "/api/odyle/calendar", auth, `{"enabled":true}`, 200)
	path, _ := made["path"].(string)
	if !strings.HasPrefix(path, "/api/odyle/calendar/") || !strings.HasSuffix(path, ".ics") {
		t.Fatalf("path %v", made)
	}
	if account := ask(t, app, http.MethodGet, "/api/odyle/account", auth, "", 200); account["calendar"].(map[string]any)["on"] != true {
		t.Fatalf("account calendar %v", account["calendar"])
	}
	feed := func(p string, status int) string {
		t.Helper()
		body := ""
		(&tests.ApiScenario{Name: "GET " + p, Method: http.MethodGet, URL: p, ExpectedStatus: status, ExpectedContent: []string{map[bool]string{true: "BEGIN:VCALENDAR", false: "{"}[status == 200]},
			TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
			AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
				raw, _ := io.ReadAll(res.Body)
				body = string(raw)
			}}).Test(t)
		return body
	}
	ics := feed(path, 200)
	for _, want := range []string{"BEGIN:VCALENDAR", "X-WR-CALNAME:Odyle runs", "SUMMARY:Fire Temple · Raid\\, night", "TRIGGER:-PT15M", "END:VCALENDAR"} {
		if !strings.Contains(ics, want) {
			t.Fatalf("feed lacks %q:\n%s", want, ics)
		}
	}
	if strings.Contains(ics, "secret note") || strings.Contains(ics, "Ice Temple") {
		t.Fatalf("the feed shows a note or a run the account is not going to:\n%s", ics)
	}
	// A new address ends the old; stopping ends every address.
	again := ask(t, app, http.MethodPost, "/api/odyle/calendar", auth, `{"enabled":true}`, 200)["path"].(string)
	feed(path, 404)
	feed(again, 200)
	ask(t, app, http.MethodPost, "/api/odyle/calendar", auth, `{"enabled":false}`, 200)
	feed(again, 404)
	feed("/api/odyle/calendar/short.ics", 404)
}

// Sign out everywhere (#198) also ends the calendar feed's address: whoever was given it, with
// the rest of the account, loses it too. The account turns the feed on again for a new address.
func TestSigningOutEverywhereEndsTheCalendarFeed(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Leaver")
	auth := tokenOf(t, user)
	path := ask(t, app, http.MethodPost, "/api/odyle/calendar", auth, `{"enabled":true}`, 200)["path"].(string)
	feed := func(status int) {
		t.Helper()
		(&tests.ApiScenario{Name: "GET feed", Method: http.MethodGet, URL: path, ExpectedStatus: status, ExpectedContent: []string{map[bool]string{true: "BEGIN:VCALENDAR", false: "{"}[status == 200]},
			TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true}).Test(t)
	}
	feed(200)
	token, _ := ask(t, app, http.MethodPost, "/api/odyle/sign-out-everywhere", auth, `{}`, 200)["token"].(string)
	fresh := map[string]string{"Authorization": token}
	feed(404)
	if account := ask(t, app, http.MethodGet, "/api/odyle/account", fresh, "", 200); account["calendar"].(map[string]any)["on"] != false {
		t.Fatalf("account calendar %v", account["calendar"])
	}
	if again := ask(t, app, http.MethodPost, "/api/odyle/calendar", fresh, `{"enabled":true}`, 200)["path"].(string); again == path {
		t.Fatal("the feed came back at its old address")
	}
}
