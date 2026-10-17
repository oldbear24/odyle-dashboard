package odyle

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
)

func TestStartedRunsAreWrappedUpAndPlannedAgain(t *testing.T) {
	app := newTestApp(t)
	lead, mate, other := newUser(t, app, "WrapLead"), newUser(t, app, "WrapMate"), newUser(t, app, "WrapOther")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	leadM := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	mateM := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	otherM := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": other.Id, "role": "reporter"})
	for _, m := range []string{leadM.Id, mateM.Id, otherM.Id} {
		saved(t, app, "room_wishes", map[string]any{"room": room.Id, "member": m, "dungeon": "Fire Temple", "key": "fire temple"})
	}
	started := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "note": "Bring potions", "startsAt": stamp(time.Now().Add(-30 * time.Minute)), "plannedBy": leadM.Id, "attendees": []string{leadM.Id, mateM.Id}})
	ahead := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(2 * time.Hour)), "plannedBy": leadM.Id, "attendees": []string{leadM.Id, mateM.Id}})
	token := func(u interface{ NewAuthToken() (string, error) }) map[string]string {
		raw, err := u.NewAuthToken()
		if err != nil {
			t.Fatal(err)
		}
		return map[string]string{"Authorization": raw}
	}
	reuse := func(testing.TB) *tests.TestApp { return app }
	plan := func(id, extra string) *strings.Reader {
		return strings.NewReader(`{"roomId":"` + room.Id + `","id":"` + id + `"` + extra + `}`)
	}
	nextWeek := time.Now().Add(-30*time.Minute + 7*24*time.Hour).UTC().Format("2006-01-02T15:04")
	for _, s := range []tests.ApiScenario{
		{Name: "a run ahead is not done yet", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: token(mate), Body: plan(ahead.Id, `,"done":true`), ExpectedStatus: 400, ExpectedContent: []string{"A run can be marked done once it has started."}},
		{Name: "an attendee cannot cancel a run ahead", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: token(mate), Body: plan(ahead.Id, `,"remove":true`), ExpectedStatus: 403, ExpectedContent: []string{"Only its planner, an officer or the room owner can cancel this run."}},
		{Name: "someone who did not go cannot mark it done", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: token(other), Body: plan(started.Id, `,"done":true`), ExpectedStatus: 403, ExpectedContent: []string{"Only its planner, an attendee, an officer or the room owner can mark this run done."}},
		{Name: "planned again a week later, the caller going", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: token(mate), Body: plan(started.Id, `,"again":true,"startsAt":"`+nextWeek+`:00.000Z"`), ExpectedStatus: 200,
			ExpectedContent: []string{`"note":"Bring potions"`, `"planner":"` + mate.Id + `","attendees":["` + mate.Id + `"]`}},
		{Name: "an attendee marks it done", Method: http.MethodPost, URL: "/api/odyle/plan", Headers: token(mate), Body: plan(started.Id, `,"done":true`), ExpectedStatus: 200, NotExpectedContent: []string{started.Id}, ExpectedContent: []string{`"runs":[`}},
	} {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
	// The dungeon left the wishlist of those who went; the others keep it.
	wishes, err := app.FindAllRecords("room_wishes")
	if err != nil || len(wishes) != 1 || wishes[0].GetString("member") != otherM.Id {
		t.Fatalf("%v: %d wishes left", err, len(wishes))
	}
	// Twenty runs ahead are the most; runs that started do not count.
	for i := range 18 {
		saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(time.Duration(i+3) * time.Hour)), "plannedBy": leadM.Id, "attendees": []string{leadM.Id}})
	}
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(-time.Hour)), "plannedBy": leadM.Id, "attendees": []string{leadM.Id}})
	if err := runRoom(app, room.Id); err == nil || !strings.Contains(err.Error(), "up to 20 runs") {
		t.Fatalf("20 ahead: %v", err)
	}
}
