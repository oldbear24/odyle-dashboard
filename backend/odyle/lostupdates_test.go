package odyle

import (
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// whileWriting runs do while another transaction holds the write lock with sql applied but
// not committed yet (half a second): what do read before it commits is stale, and what it
// writes waits for the commit. It returns once both are done.
func whileWriting(t *testing.T, app core.App, sql string, params dbx.Params, do func()) {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		done <- app.RunInTransaction(func(tx core.App) error {
			if _, err := tx.DB().NewQuery(sql).Bind(params).Execute(); err != nil {
				return err
			}
			time.Sleep(500 * time.Millisecond)
			return nil
		})
	}()
	time.Sleep(100 * time.Millisecond)
	do()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

// Run now: the pushes go once the call is saved, in the background, so the caller's answer
// and every other write do not wait for the push services.
func TestRunNowPushesAfterTheCommit(t *testing.T) {
	app := newTestApp(t)
	release, once := make(chan struct{}), sync.Once{}
	open := func() { once.Do(func() { close(release) }) }
	t.Cleanup(open)
	var mu sync.Mutex
	pushed, saw := []string{}, false
	before := pushCall
	pushCall = func(root core.App, user *core.Record, _ notificationSettings, n runInvite) {
		<-release
		_, err := root.FindRecordById("room_runs", n.RunId)
		mu.Lock()
		defer mu.Unlock()
		pushed, saw = append(pushed, user.GetString("displayName")), err == nil
	}
	t.Cleanup(func() { pushCall = before })
	lead := newUser(t, app, "Lead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	u := newUser(t, app, "Live")
	m := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": u.Id, "role": "reporter"})
	fresh := stamp(time.Now())
	c := saved(t, app, "characters", map[string]any{"user": u.Id, "characterName": "HeroLive", "server": "EU", "region": "GLOBAL_EU", "value": 10, "confirmed": true, "valid": true, "source": "packet", "lastSeenAt": fresh, "lastReadingAt": fresh})
	m.Set("sharedCharacters", []string{c.Id})
	if err := app.Save(m); err != nil {
		t.Fatal(err)
	}
	other := newUser(t, app, "Other")
	// The push waits until released (or 5 s): the answer comes before.
	safety := time.AfterFunc(5*time.Second, open)
	defer safety.Stop()
	start := time.Now()
	got := ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, lead), `{"roomId":"`+room.Id+`","dungeon":"Fire Temple","call":true}`, 200)
	if waited := time.Since(start); waited > 3*time.Second {
		t.Fatalf("the answer waited %v for the push", waited)
	}
	if runs := got["runs"].([]any); len(runs) != 1 || runs[0].(map[string]any)["called"] != true {
		t.Fatalf("runs %v", got["runs"])
	}
	// Another write is not held up by the push on its way.
	start = time.Now()
	if _, err := app.DB().NewQuery("UPDATE users SET displayName = 'Waited' WHERE id = {:id}").Bind(dbx.Params{"id": other.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	if waited := time.Since(start); waited > time.Second {
		t.Fatalf("a write waited %v for the push", waited)
	}
	open()
	stateOf(app).pushes.Wait()
	mu.Lock()
	defer mu.Unlock()
	if len(pushed) != 1 || pushed[0] != "Live" || !saw {
		t.Fatalf("pushed %v, run saved before the push: %v", pushed, saw)
	}
}

// News queued inside a transaction goes out with its commit, and not at all when it rolls back.
func TestNewsWaitsForTheCommit(t *testing.T) {
	app := newTestApp(t)
	u := newUser(t, app, "Watched")
	// What saving the account queued is delivered first.
	time.Sleep(changesDelay + 100*time.Millisecond)
	stateOf(app).changes.deliver(app)
	queued := func() bool {
		o := stateOf(app).changes
		o.mu.Lock()
		defer o.mu.Unlock()
		return o.users[u.Id] != nil
	}
	err := app.RunInTransaction(func(tx core.App) error {
		notifyUsers(tx, u.Id)
		if queued() {
			t.Error("news queued before the commit")
		}
		return errors.New("rolled back")
	})
	if err == nil || queued() {
		t.Fatalf("news of a rolled back change: %v", err)
	}
	if err := app.RunInTransaction(func(tx core.App) error {
		notifyUsers(tx, u.Id)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if !queued() {
		t.Fatal("no news after the commit")
	}
}

// The hourly activity mark writes only its field: spins granted and a token key rotated
// meanwhile (sign out everywhere) stay.
func TestTheActivityMarkKeepsChangesMadeMeanwhile(t *testing.T) {
	app := newTestApp(t)
	u := newUser(t, app, "Toucher")
	if _, err := app.DB().NewQuery("UPDATE users SET lastActiveAt = {:at}, spins = 0 WHERE id = {:id}").Bind(dbx.Params{"at": ago(2 * time.Hour), "id": u.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	auth, err := app.FindRecordById("users", u.Id)
	if err != nil {
		t.Fatal(err)
	}
	rotated := security.RandomString(50)
	whileWriting(t, app, "UPDATE users SET spins = spins + 1, tokenKey = {:key} WHERE id = {:id}", dbx.Params{"key": rotated, "id": u.Id}, func() {
		touch(&core.RequestEvent{App: app, Auth: auth})
	})
	after, err := app.FindRecordById("users", u.Id)
	if err != nil {
		t.Fatal(err)
	}
	if after.GetInt("spins") != 1 || after.TokenKey() != rotated || after.GetString("lastActiveAt") <= ago(time.Minute) {
		t.Fatalf("spins %d, token key kept %v, active %q", after.GetInt("spins"), after.TokenKey() == rotated, after.GetString("lastActiveAt"))
	}
}

// Connecting a webhook waits on Discord; a rename saved meanwhile stays.
func TestConnectingAWebhookKeepsARenameMadeMeanwhile(t *testing.T) {
	app := newTestApp(t)
	hook := newDiscordStand(t)
	owner := newUser(t, app, "Owner")
	room := saved(t, app, "party_rooms", map[string]any{"owner": owner.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": owner.Id, "role": "owner"})
	hook.answers <- func(w http.ResponseWriter) {
		time.Sleep(800 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"123456"}`))
	}
	done := make(chan map[string]any, 1)
	go func() {
		done <- ask(t, app, http.MethodPost, "/api/odyle/discord-webhook", tokenOf(t, owner), `{"roomId":"`+room.Id+`","webhook":"`+hook.url+`/api/webhooks/12345/abcdefghijklmnopqrstuvwx","language":"cs"}`, 200)
	}()
	time.Sleep(200 * time.Millisecond)
	ask(t, app, http.MethodPost, "/api/odyle/rename", tokenOf(t, owner), `{"roomId":"`+room.Id+`","name":"Renamed meanwhile"}`, 200)
	answer := <-done
	fresh, err := findAs[Room](app, "party_rooms", room.Id)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Name() != "Renamed meanwhile" || fresh.DiscordWebhook() == "" || fresh.DiscordLanguage() != "cs" || fresh.GetString("discordName") != "Odyle hook" {
		t.Fatalf("room %q, webhook %q, language %q, name %q", fresh.Name(), fresh.DiscordWebhook(), fresh.DiscordLanguage(), fresh.GetString("discordName"))
	}
	if got := answer["room"].(map[string]any)["name"]; got != "Renamed meanwhile" {
		t.Fatalf("answered room %v", got)
	}
}

// A post marked for an edit while the job edits it stays marked: a run cancelled, or changed,
// while Discord answered is shown on the next run of the job.
func TestADiscordPostMarkedDuringItsEditStaysMarked(t *testing.T) {
	for _, change := range []string{"remove", "note"} {
		t.Run(change, func(t *testing.T) {
			app := newTestApp(t)
			hook := newDiscordStand(t)
			user := newUser(t, app, "Planner")
			room, member := discordRoom(t, app, user, hook.url, nil)
			link := hook.url + "/api/webhooks/1/abcdefghijklmnopqrstuvwx"
			start := stamp(time.Now().Add(5 * time.Hour))
			run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": start, "plannedBy": member.Id, "attendees": []string{member.Id}})
			post := saved(t, app, "discord_posts", map[string]any{"room": room.Id, "run": run.Id, "webhook": security.SHA256(link), "lead": 30, "startsAt": start, "dungeon": "Fire Temple", "postedAt": stamp(time.Now()), "messageId": "123456", "dirty": true})
			hook.answers <- func(w http.ResponseWriter) {
				time.Sleep(800 * time.Millisecond)
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(`{}`))
			}
			done := make(chan struct{})
			go func() { remindRuns(app); close(done) }()
			time.Sleep(300 * time.Millisecond)
			body := `{"roomId":"` + room.Id + `","id":"` + run.Id + `","remove":true}`
			if change == "note" {
				body = `{"roomId":"` + room.Id + `","id":"` + run.Id + `","note":"Bring potions"}`
			}
			ask(t, app, http.MethodPost, "/api/odyle/plan", tokenOf(t, user), body, 200)
			<-done
			after, err := app.FindRecordById("discord_posts", post.Id)
			if err != nil {
				t.Fatal(err)
			}
			if !after.GetBool("dirty") || (change == "remove") != (after.GetString("ended") == "cancelled") {
				t.Fatalf("after the edit: ended %q, dirty %v", after.GetString("ended"), after.GetBool("dirty"))
			}
			// The next run of the job edits it again, and then it is settled.
			remindOnce(t, app)
			if edits := hook.of("PATCH"); len(edits) != 2 {
				t.Fatalf("%d edits", len(edits))
			}
			if after, _ = app.FindRecordById("discord_posts", post.Id); after.GetBool("dirty") {
				t.Fatal("still marked after the second edit")
			}
		})
	}
}

// The expiry of a reader session marks its characters stale without putting back a reading
// saved meanwhile.
func TestEndingASessionKeepsAReadingSavedMeanwhile(t *testing.T) {
	app := newTestApp(t)
	u := newUser(t, app, "Reader")
	session := saved(t, app, "publisher_sessions", map[string]any{"user": u.Id, "expiresAt": expiry(86400)})
	c := saved(t, app, "characters", map[string]any{"user": u.Id, "characterName": "Hero", "server": "EU", "region": "GLOBAL_EU", "value": 10, "confirmed": true, "valid": true, "source": "packet", "readingSession": session.Id})
	whileWriting(t, app, "UPDATE characters SET value = 99 WHERE id = {:id}", dbx.Params{"id": c.Id}, func() {
		if err := endSession(app, viewOf[ReaderSession](session)); err != nil {
			t.Fatal(err)
		}
	})
	after, err := app.FindRecordById("characters", c.Id)
	if err != nil {
		t.Fatal(err)
	}
	if after.GetInt("value") != 99 || after.GetBool("valid") {
		t.Fatalf("value %d, valid %v", after.GetInt("value"), after.GetBool("valid"))
	}
}

// An armory lookup keeps the hidden switch a superuser set meanwhile.
func TestAnArmoryLookupKeepsTheHiddenSwitch(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	stateOf(app).armory.wait()
	whileWriting(t, app, "UPDATE armory_profiles SET hidden = TRUE", dbx.Params{}, func() {
		if err := lookUpArmory(app, armoryJob{key: armoryKey(2304, id), region: "eu", serverId: 2304, characterId: id}, nil); err != nil {
			t.Fatal(err)
		}
	})
	kept, err := keptProfile(app, 2304, id)
	if err != nil || kept == nil {
		t.Fatal(kept, err)
	}
	if !kept.GetBool("hidden") {
		t.Fatal("the hidden switch was put back")
	}
}
