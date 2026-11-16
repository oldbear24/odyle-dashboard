package odyle

import (
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
)

// Shares are rows of room_shares, and the routes answer with each membership's shared characters
// as before: the room list, the snapshot, the sharing route and the role route. A member made a
// viewer shares nothing; a share goes with its character or its membership.
func TestSharesKeepTheirAnswers(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	lead, mate := newUser(t, app, "Lead"), newUser(t, app, "Mate")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Shared room", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	membership := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	first := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "First", "server": "Lumiel", "region": "GLOBAL_EU"})
	second := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Second", "server": "Lumiel", "region": "GLOBAL_EU"})
	auth := tokenOf(t, mate)
	shareOf := func(id string, enabled string) []any {
		t.Helper()
		answer := ask(t, app, http.MethodPost, "/api/odyle/sharing", auth, `{"roomId":"`+room.Id+`","characterId":"`+id+`","enabled":`+enabled+`}`, 200)
		shared, _ := answer["sharedCharacters"].([]any)
		return shared
	}
	if got := shareOf(second.Id, "true"); len(got) != 1 || got[0] != second.Id {
		t.Fatalf("shared %v", got)
	}
	if got := shareOf(first.Id, "true"); len(got) != 2 || got[0] != second.Id || got[1] != first.Id {
		t.Fatalf("shared in order %v", got)
	}
	if got := shareOf(second.Id, "true"); len(got) != 2 {
		t.Fatalf("shared twice: %v", got)
	}
	rooms := ask(t, app, http.MethodGet, "/api/odyle/rooms", auth, "", 200)
	if listed := rooms["rooms"].([]any)[0].(map[string]any); asJSON(t, listed["sharedCharacters"]) != `["`+second.Id+`","`+first.Id+`"]` || listed["sharing"] != true {
		t.Fatalf("the room list: %v", listed)
	}
	snapshot := ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, tokenOf(t, lead), "", 200)
	for _, raw := range snapshot["members"].([]any) {
		m := raw.(map[string]any)
		if m["user"] != mate.Id {
			continue
		}
		if asJSON(t, m["sharedCharacters"]) != `["`+second.Id+`","`+first.Id+`"]` || len(m["characters"].([]any)) != 2 {
			t.Fatalf("the snapshot's member: %v", m)
		}
	}
	if got := shareOf(second.Id, "false"); len(got) != 1 || got[0] != first.Id {
		t.Fatalf("unshared %v", got)
	}

	// A character deleted, its share goes; a viewer shares nothing.
	if err := app.Delete(first); err != nil {
		t.Fatal(err)
	}
	if n, _ := app.CountRecords("room_shares", dbx.HashExp{"character": first.Id}); n != 0 {
		t.Fatalf("%d shares of a deleted character", n)
	}
	shareOf(second.Id, "true")
	demoted := ask(t, app, http.MethodPost, "/api/odyle/role", tokenOf(t, lead), `{"roomId":"`+room.Id+`","memberId":"`+membership.Id+`","role":"viewer"}`, 200)
	if m := demoted["membership"].(map[string]any); m["role"] != "viewer" || asJSON(t, m["sharedCharacters"]) != `[]` {
		t.Fatalf("the viewer: %v", m)
	}
	if n := countOf(t, app, "room_shares"); n != 0 {
		t.Fatalf("a viewer shares %d characters", n)
	}

	// A membership that leaves takes its shares along.
	reporter, _ := app.FindRecordById("room_members", membership.Id)
	reporter.Set("role", "reporter")
	if err := app.Save(reporter); err != nil {
		t.Fatal(err)
	}
	shareOf(second.Id, "true")
	ask(t, app, http.MethodPost, "/api/odyle/leave", auth, `{"roomId":"`+room.Id+`"}`, 200)
	if n := countOf(t, app, "room_shares"); n != 0 {
		t.Fatalf("%d shares after leaving", n)
	}
}

// The location route lets an account see a character shared in one of its rooms only.
func TestSeenByFollowsTheShares(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	owner, mate, stranger := newUser(t, app, "Owner"), newUser(t, app, "Mate"), newUser(t, app, "Stranger")
	room := saved(t, app, "party_rooms", map[string]any{"owner": owner.Id, "name": "Seen room", "cost": 40})
	elsewhere := saved(t, app, "party_rooms", map[string]any{"owner": stranger.Id, "name": "Other room", "cost": 40})
	c := saved(t, app, "characters", map[string]any{"user": owner.Id, "characterName": "Seen", "server": "Lumiel", "region": "GLOBAL_EU"})
	ownerMember := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": owner.Id, "role": "owner"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	sharingMember(t, app, map[string]any{"room": elsewhere.Id, "user": owner.Id, "role": "reporter"})
	saved(t, app, "room_members", map[string]any{"room": elsewhere.Id, "user": stranger.Id, "role": "owner"})
	character := viewOf[Character](c)
	if err := seenBy(app, character, mate.Id); err == nil {
		t.Fatal("seen before it was shared")
	}
	share(t, app, ownerMember, c.Id)
	if err := seenBy(app, character, mate.Id); err != nil {
		t.Fatalf("not seen by a room mate: %v", err)
	}
	if err := seenBy(app, character, stranger.Id); err == nil {
		t.Fatal("seen in a room it is not shared in")
	}
	if err := seenBy(app, character, owner.Id); err != nil {
		t.Fatalf("not seen by its owner: %v", err)
	}
}
