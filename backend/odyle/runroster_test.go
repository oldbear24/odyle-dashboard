package odyle

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Class roles (#45): rooms get the default table until a superuser saves another; a table that
// does not check out is refused, a saved empty one is none, and Game settings lists the classes
// the armory learned.
func TestClassRolesFollowTheGameSettings(t *testing.T) {
	app := newTestApp(t)
	lead := newUser(t, app, "Lead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	roles := func() string {
		t.Helper()
		return fmt.Sprint(ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, tokenOf(t, lead), "", 200)["classRoles"])
	}
	if got := roles(); !strings.Contains(got, "map[class:Templar role:tank]") || !strings.Contains(got, "map[class:Cleric role:healer]") {
		t.Fatalf("default roles %s", got)
	}
	if _, err := writeSettings(app, body{"classRoles": []any{map[string]any{"class": " Chanter ", "role": "healer"}}}); err != nil {
		t.Fatal(err)
	}
	if got := roles(); got != "[map[class:Chanter role:healer]]" {
		t.Fatalf("saved roles %s", got)
	}
	for _, wrong := range []any{"Chanter", []any{map[string]any{"class": "Chanter", "role": "dps"}}, []any{map[string]any{"class": "", "role": "tank"}},
		[]any{map[string]any{"class": "Cleric", "role": "healer"}, map[string]any{"class": "cleric", "role": "support"}}} {
		if _, err := writeSettings(app, body{"classRoles": wrong}); err == nil {
			t.Fatalf("accepted %v", wrong)
		}
	}
	if _, err := writeSettings(app, body{"classRoles": []any{}}); err != nil {
		t.Fatal(err)
	}
	if got := roles(); got != "[]" {
		t.Fatalf("an empty table %s", got)
	}
	// The migration seeds the classes known at launch; a new one is listed once, whatever its ids.
	saved(t, app, "game_classes", map[string]any{"pcId": 99998, "name": "Bard"})
	saved(t, app, "game_classes", map[string]any{"pcId": 99999, "name": "Bard"})
	if got := fmt.Sprint(learnedClasses(app)); !strings.HasPrefix(got, "[Assassin Bard Chanter Cleric") || strings.Count(got, "Bard") != 1 {
		t.Fatalf("learned classes %s", got)
	}
}

// The waitlist (#45): with more going than the dungeon's party size, the first to answer make
// the party and the rest wait, in the room, on Discord and for the party-ready notice; Done
// takes the dungeon off the party's wishlists only.
func TestRunsBeyondThePartySizeWaitForAPlace(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"catalog": []any{map[string]any{"name": "Fire Temple", "cost": float64(40), "partySize": float64(4)}}}); err != nil {
		t.Fatal(err)
	}
	lead := newUser(t, app, "Lead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	users, members := []*core.Record{lead}, []*core.Record{saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})}
	fresh := stamp(time.Now())
	for _, name := range []string{"Bo", "Cy", "Di", "Ed"} {
		u := newUser(t, app, name)
		users, members = append(users, u), append(members, saved(t, app, "room_members", map[string]any{"room": room.Id, "user": u.Id, "role": "reporter"}))
	}
	for i, m := range members {
		c := saved(t, app, "characters", map[string]any{"user": users[i].Id, "characterName": "Hero" + users[i].GetString("displayName"), "server": "EU", "region": "GLOBAL_EU", "value": 100, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": fresh, "lastReadingAt": fresh})
		m.Set("sharedCharacters", []string{c.Id})
		if err := app.Save(m); err != nil {
			t.Fatal(err)
		}
		saved(t, app, "room_wishes", map[string]any{"room": room.Id, "member": m.Id, "dungeon": "Fire Temple", "key": "fire temple"})
	}
	// Ed answered last: he waits for a place.
	going := []string{members[0].Id, members[1].Id, members[2].Id, members[3].Id, members[4].Id}
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(20 * time.Minute)), "plannedBy": members[0].Id, "attendees": going})
	runs := ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, tokenOf(t, lead), "", 200)["runs"].([]any)
	if got := runs[0].(map[string]any); fmt.Sprint(got["waiting"]) != "["+users[4].Id+"]" || len(got["attendees"].([]any)) != 5 {
		t.Fatalf("waiting %v of %v", got["waiting"], got["attendees"])
	}
	r, err := findAs[Run](app, "room_runs", run.Id)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeRoomReadiness(app, room.Id); err != nil {
		t.Fatal(err)
	}
	stored, err := findAs[Room](app, "party_rooms", room.Id)
	if err != nil {
		t.Fatal(err)
	}
	p, err := runContent(app, stored, r, 15, false)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(p.going) != "[Lead Bo Cy Di]" || fmt.Sprint(p.waiting) != "[Ed]" || p.of != 4 {
		t.Fatalf("post going %v waiting %v of %d", p.going, p.waiting, p.of)
	}
	if got := asJSON(t, reminder(p, "en")); !strings.Contains(got, `"name":"Waiting for a place (1)","value":"Ed"`) || !strings.Contains(got, `"name":"Going (4)","value":"Lead, Bo, Cy, Di"`) {
		t.Fatalf("post %s", got)
	}
	// Everyone in the party plays live with enough: the party is ready, and Ed is not told.
	told := []string{}
	before := pushPartyReady
	pushPartyReady = func(_ core.App, user *core.Record, _ notificationSettings, n partyNotice) {
		told = append(told, fmt.Sprintf("%s:%d", user.GetString("displayName"), n.Of))
	}
	t.Cleanup(func() { pushPartyReady = before })
	if out, err := partyReady(app); err != nil || out.Done != 1 || fmt.Sprint(told) != "[Lead:4 Bo:4 Cy:4 Di:4]" {
		t.Fatalf("party ready %v %v %v", out, told, err)
	}
	// Done after the start: Ed keeps Fire Temple on his wishlist.
	if _, err := app.DB().NewQuery("UPDATE room_runs SET startsAt = {:at} WHERE id = {:id}").Bind(map[string]any{"at": stamp(time.Now().Add(-time.Minute)), "id": run.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, lead), `{"roomId":"`+room.Id+`","id":"`+run.Id+`","done":true}`, 200)
	left, err := app.FindAllRecords("room_wishes")
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 1 || left[0].GetString("member") != members[4].Id {
		t.Fatalf("wishes left %d", len(left))
	}
}

// writeRoomReadiness shows readiness on the room's Discord posts.
func writeRoomReadiness(app core.App, roomId string) error {
	_, err := app.DB().NewQuery("UPDATE party_rooms SET discordReadiness = TRUE WHERE id = {:id}").Bind(map[string]any{"id": roomId}).Execute()
	return err
}

// Run now: a call starts a run in about ten minutes and invites the players who play live now or
// hold a cube by then (not viewers, not those without a character), tells them by push unless it
// is their quiet hours, and a room calls once per half hour.
func TestCallingThePartyInvitesWhoCanComeNow(t *testing.T) {
	app := newTestApp(t)
	pushed := []string{}
	before := pushCall
	pushCall = func(_ core.App, user *core.Record, _ notificationSettings, n runInvite) {
		pushed = append(pushed, user.GetString("displayName")+":"+n.Dungeon+":"+fmt.Sprint(n.Now))
	}
	t.Cleanup(func() { pushCall = before })
	lead := newUser(t, app, "Lead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	fresh, old := stamp(time.Now()), stamp(time.Now().Add(-2*time.Hour))
	member := func(name, role string, value int, seen string) *core.Record {
		t.Helper()
		u := newUser(t, app, name)
		m := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": u.Id, "role": role})
		if value >= 0 {
			c := saved(t, app, "characters", map[string]any{"user": u.Id, "characterName": "Hero" + name, "server": "EU", "region": "GLOBAL_EU", "value": value, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": seen, "lastReadingAt": seen})
			m.Set("sharedCharacters", []string{c.Id})
			if err := app.Save(m); err != nil {
				t.Fatal(err)
			}
		}
		return m
	}
	live := member("Live", "reporter", 10, fresh)    // plays now, short of a cube: called
	rich := member("Rich", "officer", 400, old)      // away, holds a cube: called
	member("Poor", "reporter", 10, old)              // away and short: left out
	member("Watcher", "viewer", 400, fresh)          // a viewer: left out
	member("Empty", "reporter", -1, "")              // no character here: left out
	quiet := member("Quiet", "reporter", 400, fresh) // called, but in quiet hours: not told
	quietUser, err := app.FindRecordById("users", quiet.GetString("user"))
	if err != nil {
		t.Fatal(err)
	}
	zone := time.Now().UTC()
	if _, err := app.DB().NewQuery("UPDATE users SET notifications = {:n} WHERE id = {:id}").Bind(map[string]any{"n": fmt.Sprintf(`{"channels":{"tray":true,"browser":true,"push":true},"leadMinutes":[15],"kinds":{"runs":true},"capTicks":1,"quiet":{"from":"%02d:00","to":"%02d:00","timeZone":"UTC"}}`, (zone.Hour()+23)%24, (zone.Hour()+1)%24), "id": quietUser.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	in := `"roomId":"` + room.Id + `"`
	got := ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, lead), `{`+in+`,"dungeon":"Fire Temple","call":true}`, 200)["runs"].([]any)[0].(map[string]any)
	start, _ := parseDate(got["startsAt"].(string))
	if until := time.Until(start); until < 8*time.Minute || until > 10*time.Minute {
		t.Fatalf("starts in %v", until)
	}
	invited := fmt.Sprint(got["invited"])
	if got["called"] != true || len(got["invited"].([]any)) != 3 || !strings.Contains(invited, live.GetString("user")) || !strings.Contains(invited, rich.GetString("user")) || !strings.Contains(invited, quiet.GetString("user")) {
		t.Fatalf("called %v invited %v", got["called"], got["invited"])
	}
	if len(pushed) != 2 || !strings.Contains(strings.Join(pushed, ","), "Live:Fire Temple:true") || !strings.Contains(strings.Join(pushed, ","), "Rich:Fire Temple:true") {
		t.Fatalf("pushed %v", pushed)
	}
	// Another call within half an hour is refused; a plain run still plans.
	ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, lead), `{`+in+`,"dungeon":"Ice Temple","call":true}`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, lead), `{`+in+`,"dungeon":"Ice Temple","startsAt":"`+time.Now().Add(time.Hour).UTC().Format(time.RFC3339)+`"}`, 200)
	// Viewers cannot call.
	watcher, err := app.FindFirstRecordByFilter("users", "displayName = 'Watcher'")
	if err != nil {
		t.Fatal(err)
	}
	ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, watcher), `{`+in+`,"dungeon":"Fire Temple","call":true}`, 403)
}
