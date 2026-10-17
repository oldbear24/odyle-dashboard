package odyle

import (
	"net/http"
	"testing"
	"time"
)

// Officers (#43): the owner makes a member officer; an officer makes invite links, changes and
// cancels any run, clears a dungeon for everyone and keeps the Discord reminders, but cannot
// rename or close the room, change roles, remove members or hand the room over. When the owner
// deletes the account, an officer takes the room before a longer-standing player.
func TestOfficersRunTheRoomButTheOwnerKeepsIt(t *testing.T) {
	app := newTestApp(t)
	lead, officer, player := newUser(t, app, "Lead"), newUser(t, app, "Officer"), newUser(t, app, "Player")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	playing := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "reporter"})
	time.Sleep(10 * time.Millisecond) // the officer joins later than the player
	officering := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": officer.Id, "role": "reporter"})
	owner, mine, theirs := tokenOf(t, lead), tokenOf(t, officer), tokenOf(t, player)
	post := func(auth map[string]string, action, body string, status int) map[string]any {
		t.Helper()
		return ask(t, app, http.MethodPost, "/api/odyle/"+action, auth, body, status)
	}
	in := `"roomId":"` + room.Id + `"`
	// Only the owner grants the role; players cannot do what officers can.
	post(mine, "role", `{`+in+`,"memberId":"`+playing.Id+`","role":"officer"}`, 403)
	post(theirs, "invite-create", `{`+in+`,"role":"reporter"}`, 403)
	if m := post(owner, "role", `{`+in+`,"memberId":"`+officering.Id+`","role":"officer"}`, 200)["membership"].(map[string]any); m["role"] != "officer" {
		t.Fatalf("membership %v", m)
	}
	// An officer invites, lists and revokes links.
	made := post(mine, "invite-create", `{`+in+`,"role":"viewer"}`, 200)
	link, _ := made["invite"].(map[string]any)
	if link == nil {
		t.Fatalf("invite %v", made)
	}
	if listed := ask(t, app, http.MethodGet, "/api/odyle/invites/"+room.Id, mine, "", 200)["invites"].([]any); len(listed) == 0 {
		t.Fatalf("no links listed")
	}
	post(mine, "invite-revoke", `{`+in+`,"id":"`+link["id"].(string)+`"}`, 200)
	post(mine, "invite-create", `{`+in+`,"role":"officer"}`, 400)
	// Changes and cancels a run another member planned.
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(2 * time.Hour)), "plannedBy": playing.Id, "attendees": []string{playing.Id}})
	post(mine, "plan", `{`+in+`,"id":"`+run.Id+`","note":"Bring potions"}`, 200)
	post(theirs, "plan", `{`+in+`,"id":"`+run.Id+`","remove":true}`, 200)
	other := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Ice Temple", "startsAt": stamp(time.Now().Add(3 * time.Hour)), "plannedBy": playing.Id, "attendees": []string{playing.Id}})
	post(mine, "plan", `{`+in+`,"id":"`+other.Id+`","remove":true}`, 200)
	// Clears a dungeon off everyone's wishlist and keeps the Discord reminders.
	post(theirs, "wishlist", `{`+in+`,"dungeon":"Fire Temple","wanted":true}`, 200)
	post(theirs, "wishlist", `{`+in+`,"dungeon":"Fire Temple","wanted":false,"everyone":true}`, 403)
	post(mine, "wishlist", `{`+in+`,"dungeon":"Fire Temple","wanted":false,"everyone":true}`, 200)
	post(mine, "discord-webhook", `{`+in+`,"leads":[30],"startPost":true}`, 200)
	// The owner keeps the room itself.
	post(mine, "rename", `{`+in+`,"name":"Mine now"}`, 403)
	post(mine, "role", `{`+in+`,"memberId":"`+playing.Id+`","role":"viewer"}`, 403)
	post(mine, "revoke", `{`+in+`,"memberId":"`+playing.Id+`"}`, 403)
	post(mine, "transfer", `{`+in+`,"memberId":"`+officering.Id+`"}`, 403)
	post(mine, "close", `{`+in+`}`, 403)
	// The owner leaves for good: the officer takes the room, not the longer-standing player.
	if err := handOver(app, lead.Id); err != nil {
		t.Fatal(err)
	}
	after, err := findAs[Room](app, "party_rooms", room.Id)
	if err != nil || after.Owner() != officer.Id {
		t.Fatalf("handed over to %v (%v)", after, err)
	}
}
