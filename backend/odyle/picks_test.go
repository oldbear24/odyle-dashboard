package odyle

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
)

func TestAttendeesPickTheCharacterTheyBring(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	lead, mate := newUser(t, app, "PickLead"), newUser(t, app, "PickMate")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	main := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Main", "server": "EU", "region": "GLOBAL_EU", "value": 300, "confirmed": true})
	alt := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Alt", "server": "EU", "region": "GLOBAL_EU", "value": 90, "confirmed": true})
	hidden := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Hidden", "server": "EU", "region": "GLOBAL_EU", "value": 50, "confirmed": true})
	other := saved(t, app, "characters", map[string]any{"user": lead.Id, "characterName": "Lead", "server": "EU", "region": "GLOBAL_EU", "value": 50, "confirmed": true})
	leadMember := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner", "sharedCharacters": []string{other.Id}})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter", "sharedCharacters": []string{main.Id, alt.Id}})
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(2 * time.Hour)), "plannedBy": leadMember.Id, "attendees": []string{leadMember.Id}})
	token := func(u interface{ NewAuthToken() (string, error) }) map[string]string {
		raw, err := u.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		return map[string]string{"Authorization": raw}
	}
	auth := token(mate)
	reuse := func(testing.TB) *tests.TestApp { return app }
	going := func(extra string) *strings.Reader {
		return strings.NewReader(`{"roomId":"` + room.Id + `","id":"` + run.Id + `","going":true` + extra + `}`)
	}
	snapshot := "/api/odyle/snapshot/" + room.Id
	for _, s := range []tests.ApiScenario{
		{Name: "a character not shared here", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: auth, Body: going(`,"character":"` + hidden.Id + `"`), ExpectedStatus: 400, ExpectedContent: []string{"Pick a character you share in this room."}},
		{Name: "someone else's character", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: auth, Body: going(`,"character":"` + other.Id + `"`), ExpectedStatus: 403, ExpectedContent: []string{"This character belongs to another account."}},
		{Name: "going with the alt", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: auth, Body: going(`,"character":"` + alt.Id + `"`), ExpectedStatus: 200, ExpectedContent: []string{`"attendees":["` + lead.Id + `","` + mate.Id + `"]`, `"picks":{"` + mate.Id + `":"` + alt.Id + `"}`}},
		{Name: "the room sees the pick", Method: http.MethodGet, URL: snapshot, Headers: token(lead), ExpectedStatus: 200, ExpectedContent: []string{`"picks":{"` + mate.Id + `":"` + alt.Id + `"}`}},
		{Name: "going again without a pick keeps the place and drops the pick", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: auth, Body: going(""), ExpectedStatus: 200, ExpectedContent: []string{`"attendees":["` + lead.Id + `","` + mate.Id + `"]`, `"picks":{}`}},
		{Name: "the main instead", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: auth, Body: going(`,"character":"` + main.Id + `"`), ExpectedStatus: 200, ExpectedContent: []string{`"picks":{"` + mate.Id + `":"` + main.Id + `"}`}},
		{Name: "unshared, the pick no longer counts", Method: http.MethodPost, URL: "/api/odyle/sharing", Headers: auth, Body: strings.NewReader(`{"roomId":"` + room.Id + `","characterId":"` + main.Id + `","enabled":false}`), ExpectedStatus: 200, ExpectedContent: []string{`"sharedCharacters":["` + alt.Id + `"]`}},
		{Name: "the room no longer sees it", Method: http.MethodGet, URL: snapshot, Headers: token(lead), ExpectedStatus: 200, ExpectedContent: []string{`"picks":{}`}},
		{Name: "leaving", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: auth, Body: strings.NewReader(`{"roomId":"` + room.Id + `","id":"` + run.Id + `","going":false}`), ExpectedStatus: 200, ExpectedContent: []string{`"attendees":["` + lead.Id + `"]`}},
	} {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
}
