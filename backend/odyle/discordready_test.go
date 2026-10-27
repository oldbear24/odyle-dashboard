package odyle

import (
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Readiness in a run's Discord post (#46): counts only, edited when the count changes, the
// party's readiness once the run started, and gone again when the room turns it off.
func TestDiscordPostsCountWhoCanClaimACube(t *testing.T) {
	app := newTestApp(t)
	hook := newDiscordStand(t)
	lead, mate := newUser(t, app, "Leader"), newUser(t, app, "Mate")
	room, leader := discordRoom(t, app, lead, hook.url, map[string]any{"discordLeads": []int64{60}})
	member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	fresh, old := stamp(time.Now()), stamp(time.Now().Add(-time.Hour))
	mine := saved(t, app, "characters", map[string]any{"user": lead.Id, "characterName": "Lumina", "server": "EU", "region": "GLOBAL_EU", "value": 100, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": fresh, "lastReadingAt": fresh})
	short := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Kaelen", "server": "EU", "region": "GLOBAL_EU", "value": 30, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": old, "lastReadingAt": old})
	for m, c := range map[*core.Record]*core.Record{leader: mine, member: short} {
		m.Set("sharedCharacters", []string{c.Id})
		if err := app.Save(m); err != nil {
			t.Fatal(err)
		}
	}
	auth := tokenOf(t, lead)
	if answer := ask(t, app, "POST", "/api/odyle/discord-webhook", auth, `{"roomId":"`+room.Id+`","readiness":true}`, 200); answer["room"].(map[string]any)["discordReadiness"] != true {
		t.Fatalf("the owner's choice: %v", answer)
	}
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(50 * time.Minute)), "plannedBy": leader.Id, "attendees": []string{leader.Id, member.Id}})
	shown := func(r discordRequest) string {
		t.Helper()
		for _, f := range embedOf(t, r)["fields"].([]any) {
			if field := f.(map[string]any); field["name"] == "Can claim a cube" {
				return field["value"].(string)
			}
		}
		return ""
	}
	edits := func() int { return len(hook.of("PATCH")) }
	// The first post counts who can claim a cube by the start; a character name never shows.
	if out := remindOnce(t, app); out.Done != 1 || len(hook.of("POST")) != 1 {
		t.Fatalf("first post: %v", out)
	}
	if got := shown(hook.of("POST")[0]); got != "1/2 by the start (an estimate)" {
		t.Fatalf("first post shows %q", got)
	}
	for _, private := range []string{"Kaelen", "Lumina"} {
		if strings.Contains(asJSON(t, hook.of("POST")[0].body), private) {
			t.Fatalf("the post shows %q: %v", private, hook.of("POST")[0].body)
		}
	}
	// Nothing changed, nothing is edited.
	if remindOnce(t, app); edits() != 0 {
		t.Fatalf("edited without a change")
	}
	// The short player reads enough: the post is edited once.
	short.Set("value", 80)
	if err := app.Save(short); err != nil {
		t.Fatal(err)
	}
	if remindOnce(t, app); edits() != 1 || shown(hook.of("PATCH")[0]) != "2/2 by the start (an estimate)" {
		t.Fatalf("after the change: %d edits", edits())
	}
	if remindOnce(t, app); edits() != 1 {
		t.Fatalf("edited again")
	}
	// Once the run started, the post says the party is ready.
	r, err := findAs[Run](app, "room_runs", run.Id)
	if err != nil {
		t.Fatal(err)
	}
	r.Set("startsAt", stamp(time.Now().Add(-time.Minute)))
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	if remindOnce(t, app); edits() != 2 || shown(hook.of("PATCH")[1]) != "2/2 · party ready" {
		t.Fatalf("at the start: %d edits, %q", edits(), shown(hook.of("PATCH")[edits()-1]))
	}
	// Turned off, the posts lose the count.
	ask(t, app, "POST", "/api/odyle/discord-webhook", auth, `{"roomId":"`+room.Id+`","readiness":false}`, 200)
	if remindOnce(t, app); edits() != 3 || shown(hook.of("PATCH")[2]) != "" {
		t.Fatalf("turned off: %d edits", edits())
	}
	if remindOnce(t, app); edits() != 3 {
		t.Fatalf("edited again after turning it off")
	}
}

// The posts' language alone (#50): later posts use it and the room's open posts are edited into
// it; a language other than English or Czech is refused.
func TestRoomOwnersChangeTheLanguageOfDiscordPosts(t *testing.T) {
	app := newTestApp(t)
	hook := newDiscordStand(t)
	lead := newUser(t, app, "Leader")
	room, leader := discordRoom(t, app, lead, hook.url, map[string]any{"discordLeads": []int64{60}, "discordLanguage": "en"})
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(50 * time.Minute)), "plannedBy": leader.Id, "attendees": []string{leader.Id}})
	if out := remindOnce(t, app); out.Done != 1 || !strings.Contains(asJSON(t, hook.of("POST")[0].body), "Going (1)") {
		t.Fatalf("first post: %v", out)
	}
	auth := tokenOf(t, lead)
	answer := ask(t, app, "POST", "/api/odyle/discord-webhook", auth, `{"roomId":"`+room.Id+`","language":"cs"}`, 200)
	if got := answer["room"].(map[string]any); got["discordLanguage"] != "cs" || got["discordReminders"] != true {
		t.Fatalf("room %v", got)
	}
	if remindOnce(t, app); len(hook.of("PATCH")) != 1 || !strings.Contains(asJSON(t, hook.of("PATCH")[0].body), "Jdou (1)") {
		t.Fatalf("the open post is edited into Czech: %d edits", len(hook.of("PATCH")))
	}
	ask(t, app, "POST", "/api/odyle/discord-webhook", auth, `{"roomId":"`+room.Id+`","language":"de"}`, 400)
	ask(t, app, "POST", "/api/odyle/discord-webhook", auth, `{"roomId":"`+room.Id+`","language":"cs"}`, 200)
	if remindOnce(t, app); len(hook.of("PATCH")) != 1 {
		t.Fatalf("the same language edits nothing")
	}
}
