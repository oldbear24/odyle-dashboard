package odyle

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Party ready (#48): once everyone going plays live with enough for a cube, each of them is told
// once per start time, unless they turned it off; an offline attendee holds it back.
func TestEveryoneGoingIsToldOnceThePartyIsReady(t *testing.T) {
	app := newTestApp(t)
	told := []string{}
	before := pushPartyReady
	pushPartyReady = func(_ core.App, user *core.Record, _ notificationSettings, n partyNotice) {
		told = append(told, user.GetString("displayName")+":"+n.Dungeon)
	}
	t.Cleanup(func() { pushPartyReady = before })
	lead, mate := newUser(t, app, "Leader"), newUser(t, app, "Mate")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	leader := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	fresh, old := stamp(time.Now()), stamp(time.Now().Add(-time.Hour))
	mine := saved(t, app, "characters", map[string]any{"user": lead.Id, "characterName": "Lumina", "server": "EU", "region": "GLOBAL_EU", "value": 100, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": fresh, "lastReadingAt": fresh})
	theirs := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Kaelen", "server": "EU", "region": "GLOBAL_EU", "value": 80, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": old, "lastReadingAt": old})
	for m, c := range map[*core.Record]*core.Record{leader: mine, member: theirs} {
		m.Set("sharedCharacters", []string{c.Id})
		if err := app.Save(m); err != nil {
			t.Fatal(err)
		}
	}
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(30 * time.Minute)), "plannedBy": leader.Id, "attendees": []string{leader.Id, member.Id}})
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Far Away", "startsAt": stamp(time.Now().Add(3 * time.Hour)), "plannedBy": leader.Id, "attendees": []string{leader.Id, member.Id}})
	tick := func() result {
		t.Helper()
		out, err := partyReady(app)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	// The mate is not in the game: nobody is told.
	if out := tick(); out.Done != 0 || len(told) != 0 {
		t.Fatalf("not everyone live: %v %v", out, told)
	}
	// The mate plays now, but turned it off: only the leader is told, once.
	if _, err := app.DB().NewQuery("UPDATE users SET notifications = {:n} WHERE id = {:id}").Bind(map[string]any{"n": `{"channels":{"tray":true,"browser":true,"push":true},"leadMinutes":[15],"kinds":{"runs":true,"cap":false,"ready":false},"capTicks":1,"quiet":{"from":"","to":"","timeZone":""}}`, "id": mate.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	theirs.Set("lastSeenAt", stamp(time.Now()))
	if err := app.Save(theirs); err != nil {
		t.Fatal(err)
	}
	if out := tick(); out.Done != 1 || len(told) != 1 || told[0] != "Leader:Fire Temple" {
		t.Fatalf("ready: %v %v", out, told)
	}
	if out := tick(); out.Done != 0 || len(told) != 1 {
		t.Fatalf("told again: %v %v", out, told)
	}
	// Moved to another start time, it is told again (still ready).
	r, err := findAs[Run](app, "room_runs", run.Id)
	if err != nil {
		t.Fatal(err)
	}
	r.Set("startsAt", stamp(time.Now().Add(40*time.Minute)))
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	if out := tick(); out.Done != 1 || len(told) != 2 {
		t.Fatalf("a new start time: %v %v", out, told)
	}
}
