package odyle

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestNewCharactersReachTheRoomsThatAskForThem(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player, lead := newUser(t, app, "Player"), newUser(t, app, "Lead")
	room := func(name string) *Room {
		r, _ := findAs[Room](app, "party_rooms", saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": name, "cost": 40}).Id)
		return r
	}
	auto, private, watched := room("Auto"), room("Private"), room("Watched")
	for _, r := range []*Room{auto, private} {
		saved(t, app, "room_members", map[string]any{"room": r.Id, "user": player.Id, "role": "reporter"})
	}
	saved(t, app, "room_members", map[string]any{"room": watched.Id, "user": player.Id, "role": "viewer", "shareNew": true})
	session := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	raw, err := player.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	auth := map[string]string{"Authorization": raw}
	reuse := func(testing.TB) *tests.TestApp { return app }
	reading := `{"sessionId":"` + session.Id + `","sequence":1,"characterName":"Fresh","server":"Lumiel","region":"GLOBAL_EU","value":120,"source":"packet","parserVersion":"global-reference-v2","confirmed":true}`
	for _, s := range []tests.ApiScenario{
		{Name: "a viewer cannot ask", Method: http.MethodPost, URL: "/api/odyle/share-new", Headers: auth, Body: strings.NewReader(`{"roomId":"` + watched.Id + `","enabled":true}`), ExpectedStatus: 403, ExpectedContent: []string{"Viewers cannot share characters with this room."}},
		{Name: "a player asks one room", Method: http.MethodPost, URL: "/api/odyle/share-new", Headers: auth, Body: strings.NewReader(`{"roomId":"` + auto.Id + `","enabled":true}`), ExpectedStatus: 200, ExpectedContent: []string{`"shareNew":true`}},
		{Name: "the rooms answer says so", Method: http.MethodGet, URL: "/api/odyle/rooms", Headers: auth, ExpectedStatus: 200, ExpectedContent: []string{`"shareNew":true`, `"shareNew":false`}},
		{Name: "a character the reader sees first", Method: http.MethodPost, URL: "/api/odyle/report", Headers: auth, Body: strings.NewReader(reading), ExpectedStatus: 200, ExpectedContent: []string{`"characterName":"Fresh"`}},
		{Name: "a character saved on the dashboard", Method: http.MethodPost, URL: "/api/odyle/character", Headers: auth, Body: strings.NewReader(`{"characterName":"Typed","server":"Lumiel","region":"GLOBAL_EU"}`), ExpectedStatus: 200, ExpectedContent: []string{`"characterName":"Typed"`}},
	} {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
	shared := func(r *Room) []string {
		t.Helper()
		members, err := membershipsWhere(app, "room = {:room} && user = {:user}", map[string]any{"room": r.Id, "user": player.Id})
		if err != nil || len(members) != 1 {
			t.Fatalf("%v %d", err, len(members))
		}
		names := []string{}
		for _, id := range members[0].Shared() {
			c, _ := findAs[Character](app, "characters", id)
			names = append(names, c.Name())
		}
		return names
	}
	if got := strings.Join(shared(auto), ","); got != "Fresh,Typed" {
		t.Fatalf("auto room shares %q", got)
	}
	if len(shared(private)) != 0 || len(shared(watched)) != 0 {
		t.Fatalf("private %v, watched %v", shared(private), shared(watched))
	}
	// A later reading of the same character shares nothing again.
	again := strings.Replace(reading, `"sequence":1`, `"sequence":2`, 1)
	s := tests.ApiScenario{Name: "the same character again", Method: http.MethodPost, URL: "/api/odyle/report", Headers: auth, Body: strings.NewReader(strings.Replace(again, `"value":120`, `"value":130`, 1)), ExpectedStatus: 200, ExpectedContent: []string{`"value":130`}, TestAppFactory: reuse, DisableTestAppCleanup: true}
	s.Test(t)
	if got := strings.Join(shared(auto), ","); got != "Fresh,Typed" {
		t.Fatalf("auto room shares %q", got)
	}
}
