package odyle

import (
	"testing"
)

func TestTheMembershipAnswerSettlesEachCharactersCap(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	player, lead := newUser(t, app, "Player"), newUser(t, app, "Lead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	main, alt := newGameCharacter(t, app, player.Id, "Main"), newGameCharacter(t, app, player.Id, "Alt")
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "reporter", "sharedCharacters": []string{main}})
	capOf := func(id string) int64 {
		t.Helper()
		c, err := app.FindRecordById("characters", id)
		if err != nil {
			t.Fatal(err)
		}
		return c.GetInt64("answeredCap")
	}
	auth := tokenOf(t, player)
	// A new account starts without the membership: every character of the account is capped at 560.
	if capOf(main) != 560 || capOf(alt) != 560 || ask(t, app, "GET", "/api/odyle/account", auth, "", 200)["membership"] != "no" {
		t.Fatalf("no membership by default: caps %d %d", capOf(main), capOf(alt))
	}
	// Not sure: the readings decide; saying no again settles 560, and the answer itself is the account's.
	ask(t, app, "POST", "/api/odyle/membership", auth, `{"membership":""}`, 200)
	if capOf(main) != 0 || capOf(alt) != 0 {
		t.Fatal("open")
	}
	if out := ask(t, app, "POST", "/api/odyle/membership", auth, `{"membership":"no"}`, 200); out["membership"] != "no" {
		t.Fatalf("answer: %v", out)
	}
	if capOf(main) != 560 || capOf(alt) != 560 || ask(t, app, "GET", "/api/odyle/account", auth, "", 200)["membership"] != "no" {
		t.Fatalf("caps %d %d", capOf(main), capOf(alt))
	}
	// Rooms see the cap of the shared character, never the answer.
	snapshot := ask(t, app, "GET", "/api/odyle/snapshot/"+room.Id, tokenOf(t, lead), "", 200)
	members, _ := snapshot["members"].([]any)
	found := false
	for _, m := range members {
		member := m.(map[string]any)
		if _, leaked := member["membership"]; leaked {
			t.Fatal("the answer reached the room")
		}
		for _, c := range member["characters"].([]any) {
			if c.(map[string]any)["answeredCap"] == float64(560) {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("snapshot %v", snapshot)
	}
	// With the membership: the largest cap; a character saved later gets it too.
	ask(t, app, "POST", "/api/odyle/membership", auth, `{"membership":"yes"}`, 200)
	later := newGameCharacter(t, app, player.Id, "Later")
	if capOf(main) != 840 || capOf(later) != 840 {
		t.Fatalf("caps %d %d", capOf(main), capOf(later))
	}
	// New caps under Game settings move the answered ones with them.
	if _, err := writeSettings(app, body{"clock": map[string]any{"tickHours": []any{1.0, 4.0}, "tick": 15.0, "caps": []any{500.0, 900.0}, "paused": false}}); err != nil {
		t.Fatal(err)
	}
	if capOf(main) != 900 || capOf(newGameCharacter(t, app, lead.Id, "Lead")) != 500 {
		t.Fatalf("after new caps %d", capOf(main))
	}
	// Not sure again: the readings decide; anything else is refused.
	ask(t, app, "POST", "/api/odyle/membership", auth, `{"membership":""}`, 200)
	if capOf(main) != 0 || capOf(later) != 0 {
		t.Fatal("open again")
	}
	if out := ask(t, app, "POST", "/api/odyle/membership", auth, `{"membership":"maybe"}`, 400); out["message"] != "Answer yes, no, or leave the membership open." {
		t.Fatalf("bad answer: %v", out)
	}
	ask(t, app, "POST", "/api/odyle/membership", auth, `{"membership":"no"}`, 200)
	if export := ask(t, app, "GET", "/api/odyle/export", auth, "", 200); export["membership"] != "no" {
		t.Fatalf("export: %v", export["membership"])
	}
}

func TestCapAlertsAndTheClockCheckUseTheAnsweredCap(t *testing.T) {
	rules := defaultClock()
	if got := capsFor(answeredCap("no", rules.Caps), 0, rules.Caps); len(got) != 1 || got[0] != 560 {
		t.Fatalf("no: %v", got)
	}
	if got := capsFor(answeredCap("yes", rules.Caps), 0, rules.Caps); len(got) != 1 || got[0] != 840 {
		t.Fatalf("yes: %v", got)
	}
	if got := capsFor(answeredCap("", rules.Caps), 0, rules.Caps); len(got) != 2 {
		t.Fatalf("open: %v", got)
	}
	if answeredCap("yes", nil) != 0 {
		t.Fatal("no caps, no answer")
	}
}
