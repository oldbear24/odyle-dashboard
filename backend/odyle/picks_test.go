package odyle

import (
	"fmt"
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

// Can't (#45): a member answers they cannot come, which takes them off the run; going again or
// taking the answer back clears it. Viewers cannot answer.
func TestMembersAnswerTheyCannotCome(t *testing.T) {
	app := newTestApp(t)
	lead, mate, watcher := newUser(t, app, "Lead"), newUser(t, app, "Mate"), newUser(t, app, "Watcher")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	leader := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": watcher.Id, "role": "viewer"})
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(2 * time.Hour)), "plannedBy": leader.Id, "attendees": []string{leader.Id, member.Id}})
	in, auth := `"roomId":"`+room.Id+`","id":"`+run.Id+`"`, tokenOf(t, mate)
	answer := func(body string, status int) map[string]any {
		t.Helper()
		return ask(t, app, http.MethodPost, "/api/odyle/plan", auth, `{`+in+`,`+body+`}`, status)
	}
	only := func(got map[string]any) map[string]any {
		t.Helper()
		for _, r := range got["runs"].([]any) {
			if r.(map[string]any)["id"] == run.Id {
				return r.(map[string]any)
			}
		}
		t.Fatalf("run missing: %v", got)
		return nil
	}
	got := only(answer(`"cant":true`, 200))
	if fmt.Sprint(got["attendees"]) != "["+lead.Id+"]" || fmt.Sprint(got["cant"]) != "["+mate.Id+"]" {
		t.Fatalf("can't: %v", got)
	}
	if got = only(answer(`"going":true`, 200)); fmt.Sprint(got["cant"]) != "[]" || len(got["attendees"].([]any)) != 2 {
		t.Fatalf("going again: %v", got)
	}
	answer(`"cant":true`, 200)
	if got = only(answer(`"cant":false`, 200)); fmt.Sprint(got["cant"]) != "[]" || len(got["attendees"].([]any)) != 1 {
		t.Fatalf("taken back, still not going: %v", got)
	}
	answer(`"cant":"maybe"`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, watcher), `{`+in+`,"cant":true}`, 403)
}

// Wishlist invites (#45): a run planned from the wishlist invites the members who want its
// dungeon (the planner aside); one who answers drops off the invited list, and a run planned
// without it invites nobody.
func TestRunsPlannedFromTheWishlistInviteItsWishers(t *testing.T) {
	app := newTestApp(t)
	lead, mate, other := newUser(t, app, "Lead"), newUser(t, app, "Mate"), newUser(t, app, "Other")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": other.Id, "role": "reporter"})
	in := `"roomId":"` + room.Id + `"`
	for _, u := range []map[string]string{tokenOf(t, lead), tokenOf(t, mate)} {
		ask(t, app, http.MethodPost, "/api/odyle/wishlist", u, `{`+in+`,"dungeon":"Fire Temple","wanted":true}`, 200)
	}
	start := time.Now().Add(3 * time.Hour).UTC().Format(time.RFC3339)
	runOf := func(got map[string]any, dungeon string) map[string]any {
		t.Helper()
		for _, r := range got["runs"].([]any) {
			if r.(map[string]any)["dungeon"] == dungeon {
				return r.(map[string]any)
			}
		}
		t.Fatalf("no %s run: %v", dungeon, got)
		return nil
	}
	planned := runOf(ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, lead), `{`+in+`,"dungeon":"Fire Temple","startsAt":"`+start+`","fromWish":true}`, 200), "Fire Temple")
	if fmt.Sprint(planned["invited"]) != "["+mate.Id+"]" {
		t.Fatalf("invited %v", planned["invited"])
	}
	answered := runOf(ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, mate), `{`+in+`,"id":"`+planned["id"].(string)+`","going":true}`, 200), "Fire Temple")
	if fmt.Sprint(answered["invited"]) != "[]" {
		t.Fatalf("the invitee who answered is still listed: %v", answered["invited"])
	}
	plain := runOf(ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, lead), `{`+in+`,"dungeon":"Ice Temple","startsAt":"`+start+`"}`, 200), "Ice Temple")
	if fmt.Sprint(plain["invited"]) != "[]" {
		t.Fatalf("a run not from the wishlist invited %v", plain["invited"])
	}
}
