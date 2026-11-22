package odyle

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Ids from clients: text as it is, numbers spelled out, and nothing for what is no text, so a
// left-out id no longer reads "undefined" (the JavaScript port's String(undefined)).
func TestBodyTextOfAnId(t *testing.T) {
	b := body{"text": "abc", "number": float64(2304), "fraction": 1.5, "yes": true, "null": nil, "list": []any{"a", nil, float64(1)}, "object": map[string]any{"a": 1}}
	for key, want := range map[string]string{"text": "abc", "number": "2304", "fraction": "1.5", "yes": "true", "null": "", "list": "", "object": "", "missing": ""} {
		if got := b.str(key); got != want {
			t.Errorf("str(%q) = %q, want %q", key, got, want)
		}
	}
}

// A lookup that finds nothing is told apart by its error, not by its text, wherever it comes
// from: a record by id or filter, a raw query, inside a transaction or not.
func TestNoRowsIsTheDatabaseFindingNothing(t *testing.T) {
	app := newTestApp(t)
	missing := []error{}
	_, err := app.FindRecordById("characters", "missingmissing1")
	missing = append(missing, err)
	_, err = findAs[Character](app, "characters", "")
	missing = append(missing, err)
	_, err = app.FindFirstRecordByFilter("characters", "characterName = {:name}", dbx.Params{"name": "Nobody"})
	missing = append(missing, err)
	_, err = app.FindFirstRecordByData("room_invites", "digest", "none")
	missing = append(missing, err)
	var j characterJobs
	missing = append(missing, app.DB().NewQuery(jobsSelect+"WHERE [[character]] = {:character}").Bind(dbx.Params{"character": "none"}).One(&j))
	missing = append(missing, app.RunInTransaction(func(tx core.App) error {
		_, err := findAs[Room](tx, "party_rooms", "missingmissing1")
		return err
	}))
	missing = append(missing, fmt.Errorf("wrapped: %w", missing[0]))
	for i, err := range missing {
		if err == nil || !isNoRows(err) {
			t.Errorf("lookup %d: %v is not no rows", i, err)
		}
	}
	for _, err := range []error{nil, errors.New("database is locked"), badRequest("no rows in result set")} {
		if isNoRows(err) {
			t.Errorf("%v counts as no rows", err)
		}
	}
	if err := run(pageEventFor(app), func() error { return missing[2] }); apiStatus(err) != 404 {
		t.Fatalf("a record gone meanwhile answers %v", err)
	}
}

func pageEventFor(app core.App) *core.RequestEvent {
	e, _ := pageEvent(app, "/api/odyle/test")
	return e
}

// changed compares what the database would store: a record as loaded has not changed, the same
// values set again (a number, a date in another form, the same JSON) have not, and another value
// has.
func TestChangedComparesStoredValues(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Lead")
	at := time.Now().UTC().Truncate(time.Millisecond)
	saved(t, app, "characters", map[string]any{"user": user.Id, "characterName": "Kai", "server": "Lumiel", "region": "GLOBAL_EU", "value": 120, "lastSeenAt": stamp(at),
		"parts": map[string]any{"natural": 100, "items": 20}, "pvp": pvpCounts{}})
	c, err := app.FindFirstRecordByData("characters", "characterName", "Kai")
	if err != nil {
		t.Fatal(err)
	}
	if visiblyChanged(c) {
		t.Fatal("a record as loaded changed")
	}
	c.Set("value", 120.0)
	c.Set("lastSeenAt", at)
	c.Set("parts", map[string]any{"items": 20, "natural": 100})
	c.Set("pvp", pvpCounts{})
	c.Set("characterName", "Kai")
	if visiblyChanged(c) {
		t.Fatal("the same values set again changed the record")
	}
	for field, value := range map[string]any{"value": 121, "lastSeenAt": at.Add(time.Second), "parts": map[string]any{"natural": 101, "items": 20}, "characterName": "Kai2", "valid": true} {
		fresh := c.Fresh()
		fresh.Set(field, value)
		if !changed(fresh, field) {
			t.Errorf("%s set to %v did not change", field, value)
		}
	}
	// A field the realtime list leaves out is not looked at.
	c.Set("portraitCheckedAt", now())
	if visiblyChanged(c) {
		t.Fatal("a field clients do not show counted")
	}
}

// Routes that no longer list the rooms they changed (affected) still have every member told:
// the record hooks of room_members, party_rooms, room_runs and characters (realtime.go) refresh
// the room on every success, also when a save changes nothing.
func TestRecordHooksRefreshTheRoomsRoutesChange(t *testing.T) {
	app := newTestApp(t)
	lead, mate, watcher, newcomer, other := newUser(t, app, "Lead"), newUser(t, app, "Mate"), newUser(t, app, "Watcher"), newUser(t, app, "Newcomer"), newUser(t, app, "Other")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	mates := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": watcher.Id, "role": "viewer"})
	kai := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Kai", "server": "Lumiel", "region": "GLOBAL_EU"})
	started := saved(t, app, "room_runs", map[string]any{"room": room.Id, "plannedBy": mates.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(-time.Hour)), "attendees": []string{mates.Id}})
	owner, mine := tokenOf(t, lead), tokenOf(t, mate)
	deliver(app)
	watching := listen(t, app, watcher, roomTopic+room.Id)
	in := `"roomId":"` + room.Id + `"`
	told := func(step string) {
		t.Helper()
		deliver(app)
		refreshed := false
		for {
			_, data, ok := watching.next()
			if !ok {
				break
			}
			refreshed = refreshed || data["refresh"] == true
		}
		if !refreshed {
			t.Fatalf("%s: the room was not refreshed", step)
		}
	}
	post := func(auth map[string]string, route, rest string) map[string]any {
		t.Helper()
		return ask(t, app, http.MethodPost, "/api/odyle/"+route, auth, `{`+in+rest+`}`, 200)
	}

	post(mine, "share-new", `,"enabled":true`)
	told("share-new")
	post(owner, "board", `,"text":"Fire Temple at eight"`)
	told("board")
	post(owner, "room-features", `,"features":{"wishlist":true}`)
	told("room features, unchanged")
	post(owner, "rename", `,"name":"Raid"`)
	told("rename, unchanged")
	post(owner, "role", `,"memberId":"`+mates.Id+`","role":"reporter"`)
	told("role, unchanged")

	// Every verb of plan.
	planned := post(owner, "plan", `,"dungeon":"Fire Temple","startsAt":"`+time.Now().Add(2*time.Hour).UTC().Format(time.RFC3339)+`"`)
	told("plan a run")
	runId := ""
	for _, r := range planned["runs"].([]any) {
		if r.(map[string]any)["id"] != started.Id {
			runId = r.(map[string]any)["id"].(string)
		}
	}
	run := `,"id":"` + runId + `"`
	post(mine, "plan", run+`,"going":true`)
	told("going")
	post(mine, "plan", run+`,"going":true`)
	told("going again, unchanged")
	post(mine, "plan", run+`,"cant":false`)
	told("can't taken back")
	post(owner, "plan", run+`,"note":""`)
	told("a change, unchanged")
	post(owner, "plan", run+`,"again":true`)
	told("again")
	post(owner, "plan", run+`,"remove":true`)
	told("remove")
	post(mine, "plan", `,"id":"`+started.Id+`","done":true`)
	told("done")

	post(mine, "delete-character", `,"characterId":"`+kai.Id+`"`)
	told("delete a character")

	code := post(owner, "invite-create", `,"role":"reporter"`)["invite"].(map[string]any)["code"].(string)
	ask(t, app, http.MethodPost, "/api/odyle/join", tokenOf(t, newcomer), `{"code":"`+code+`"}`, 200)
	told("join")
	post(tokenOf(t, newcomer), "leave", ``)
	told("leave")
	joined := ask(t, app, http.MethodPost, "/api/odyle/join", tokenOf(t, other), `{"code":"`+code+`"}`, 200)
	told("join again")
	post(owner, "revoke", `,"memberId":"`+joined["membership"].(map[string]any)["id"].(string)+`"`)
	told("revoke")
	post(owner, "transfer", `,"memberId":"`+mates.Id+`"`)
	told("transfer")
}
