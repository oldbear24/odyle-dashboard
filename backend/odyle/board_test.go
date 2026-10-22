package odyle

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// The information board: the owner and officers write it, every member reads it in the snapshot,
// the room list never carries it and a long one needs more than the 4 KB of other routes.
func TestTheBoardIsWrittenByTheOwnerAndOfficers(t *testing.T) {
	app := newTestApp(t)
	lead, officer, player, viewer := newUser(t, app, "Lead"), newUser(t, app, "Officer"), newUser(t, app, "Player"), newUser(t, app, "Viewer")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": officer.Id, "role": "officer"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "reporter"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": viewer.Id, "role": "viewer"})
	owner, mine, theirs, watching := tokenOf(t, lead), tokenOf(t, officer), tokenOf(t, player), tokenOf(t, viewer)
	in := `"roomId":"` + room.Id + `"`
	write := func(auth map[string]string, text string, status int) map[string]any {
		t.Helper()
		return ask(t, app, http.MethodPost, "/api/odyle/board", auth, `{`+in+`,"text":`+text+`}`, status)
	}
	snapshot := func(auth map[string]string) map[string]any {
		t.Helper()
		return ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, auth, "", 200)
	}
	if got := snapshot(theirs)["board"]; got != nil {
		t.Fatalf("a new room has a board: %v", got)
	}
	write(theirs, `"Mine"`, 403)
	write(watching, `"Mine"`, 403)
	write(owner, `42`, 400)
	// Lines stay; spaces ending a line and extra empty lines go.
	board, _ := write(owner, `"  Raid on Wednesday at 20:00  \r\n\r\n\r\n- bring potions\u200b \n"`, 200)["board"].(map[string]any)
	if board["text"] != "  Raid on Wednesday at 20:00\n\n- bring potions" || board["by"] != lead.Id || board["at"] == "" {
		t.Fatalf("board %v", board)
	}
	if got, _ := snapshot(watching)["board"].(map[string]any); got["text"] != board["text"] {
		t.Fatalf("a viewer reads %v", got)
	}
	// An officer writes it too, up to 2,000 characters, which take more than 4 KB.
	long := strings.Repeat("Ž", 1999) + "\n"
	board, _ = write(mine, `"`+strings.ReplaceAll(long, "\n", `\n`)+`"`, 200)["board"].(map[string]any)
	if board["by"] != officer.Id || length(board["text"].(string)) != 1999 {
		t.Fatalf("board by %v of %d characters", board["by"], length(board["text"].(string)))
	}
	write(mine, `"`+strings.Repeat("Ž", 2001)+`"`, 400)
	// The room list leaves it out; clearing it empties the board.
	for _, r := range ask(t, app, http.MethodGet, "/api/odyle/rooms", theirs, "", 200)["rooms"].([]any) {
		if r := r.(map[string]any); r["board"] != nil || r["boardBy"] != nil {
			t.Fatalf("the room list carries the board: %v", r)
		}
	}
	if got := write(owner, `" \n "`, 200)["board"]; got != nil {
		t.Fatalf("cleared board %v", got)
	}
	if got := snapshot(owner)["board"]; got != nil {
		t.Fatalf("cleared board in the snapshot: %v", got)
	}
}

// Room features: the owner turns parts of the room off and on again; a part turned off is
// empty for every member and refuses changes, and turning it on brings back what it kept.
// Planned runs keep nothing: turning them off cancels the runs ahead.
func TestTheOwnerTurnsRoomFeaturesOffAndOn(t *testing.T) {
	app := newTestApp(t)
	lead, officer, player := newUser(t, app, "Lead"), newUser(t, app, "Officer"), newUser(t, app, "Player")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	leading := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": officer.Id, "role": "officer"})
	playing := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": player.Id, "role": "reporter"})
	owner, mine, theirs := tokenOf(t, lead), tokenOf(t, officer), tokenOf(t, player)
	in := `"roomId":"` + room.Id + `"`
	post := func(auth map[string]string, action, body string, status int) map[string]any {
		t.Helper()
		return ask(t, app, http.MethodPost, "/api/odyle/"+action, auth, `{`+in+body+`}`, status)
	}
	snapshot := func() map[string]any {
		t.Helper()
		return ask(t, app, http.MethodGet, "/api/odyle/snapshot/"+room.Id, theirs, "", 200)
	}
	features := func(r map[string]any) map[string]any {
		t.Helper()
		f, _ := r["room"].(map[string]any)["features"].(map[string]any)
		return f
	}
	// Every feature is on in a room that never set one, in the room list too.
	if f := features(snapshot()); f["board"] != true || f["runs"] != true || f["wishlist"] != true || f["week"] != true {
		t.Fatalf("features %v", f)
	}
	if r := ask(t, app, http.MethodGet, "/api/odyle/rooms", theirs, "", 200)["rooms"].([]any)[0].(map[string]any); r["features"].(map[string]any)["runs"] != true {
		t.Fatalf("room list %v", r)
	}
	post(owner, "board", `,"text":"Raid on Wednesday"`, 200)
	post(theirs, "wishlist", `,"dungeon":"Fire Temple","wanted":true`, 200)
	ahead := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(2 * time.Hour)), "plannedBy": playing.Id, "attendees": []string{playing.Id}})
	saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Ice Temple", "startsAt": stamp(time.Now().Add(-time.Hour)), "plannedBy": leading.Id, "attendees": []string{leading.Id}})
	saved(t, app, "discord_posts", map[string]any{"room": room.Id, "run": ahead.Id, "messageId": "1", "startsAt": stamp(time.Now().Add(2 * time.Hour))})
	// Only the owner, with known features and true or false.
	post(mine, "room-features", `,"features":{"wishlist":false}`, 403)
	post(theirs, "room-features", `,"features":{"wishlist":false}`, 403)
	post(owner, "room-features", `,"features":{}`, 400)
	post(owner, "room-features", `,"features":{"slots":false}`, 400)
	post(owner, "room-features", `,"features":{"wishlist":"no"}`, 400)
	// Everything off: the runs ahead are cancelled with their Discord posts, the rest is kept.
	off := post(owner, "room-features", `,"features":{"board":false,"runs":false,"wishlist":false,"week":false}`, 200)
	if f := features(off); f["board"] != false || f["runs"] != false || f["wishlist"] != false || f["week"] != false || off["cancelled"] != float64(1) {
		t.Fatalf("turned off: %v", off)
	}
	if n := countOf(t, app, "room_runs"); n != 0 {
		t.Fatalf("%d runs left", n)
	}
	if post, err := app.FindFirstRecordByData("discord_posts", "run", ahead.Id); err != nil || post.GetString("ended") != "cancelled" || !post.GetBool("dirty") {
		t.Fatalf("the run's Discord post %v (%v)", post, err)
	}
	s := snapshot()
	if s["board"] != nil || len(s["wishlist"].([]any)) != 0 || len(s["runs"].([]any)) != 0 || s["week"] != nil {
		t.Fatalf("snapshot with everything off: board %v, wishlist %v, runs %v, week %v", s["board"], s["wishlist"], s["runs"], s["week"])
	}
	post(mine, "board", `,"text":"Officers only"`, 403)
	post(theirs, "wishlist", `,"dungeon":"Ice Temple","wanted":true`, 403)
	post(theirs, "plan", `,"dungeon":"Fire Temple","startsAt":"`+stamp(time.Now().Add(time.Hour))+`"`, 403)
	// On again: the board and the wishlist come back as they were; runs are planned anew.
	on := post(owner, "room-features", `,"features":{"board":true,"wishlist":true,"runs":true}`, 200)
	if f := features(on); f["board"] != true || f["runs"] != true || f["wishlist"] != true || f["week"] != false || on["cancelled"] != float64(0) {
		t.Fatalf("turned on: %v", on)
	}
	s = snapshot()
	if board, _ := s["board"].(map[string]any); board["text"] != "Raid on Wednesday" || len(s["wishlist"].([]any)) != 1 {
		t.Fatalf("snapshot after turning on: board %v, wishlist %v", s["board"], s["wishlist"])
	}
	post(theirs, "plan", `,"dungeon":"Fire Temple","startsAt":"`+stamp(time.Now().Add(time.Hour))+`"`, 200)
}
