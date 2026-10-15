package odyle

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

// listener is a realtime client signed in as an account, subscribed to topics. Like
// the SSE handler it takes every message at once, so no send waits for it.
type listener struct {
	t        *testing.T
	client   *subscriptions.DefaultClient
	messages chan subscriptions.Message
}

func listen(t *testing.T, app core.App, auth *core.Record, topics ...string) *listener {
	t.Helper()
	c := subscriptions.NewDefaultClient()
	c.Set(apis.RealtimeClientAuthKey, auth)
	c.Subscribe(topics...)
	app.SubscriptionsBroker().Register(c)
	l := &listener{t: t, client: c, messages: make(chan subscriptions.Message, 100)}
	channel := c.Channel()
	go func() {
		for m := range channel {
			l.messages <- m
		}
	}()
	// Unsubscribed rather than discarded: closing the channel while a delivery sends on
	// it is the broker's known race, which its Send recovers from.
	t.Cleanup(func() { c.Unsubscribe() })
	return l
}

// next is the next message, or ok false when none arrives within 300 ms.
func (l *listener) next() (topic string, data map[string]any, ok bool) {
	select {
	case m := <-l.messages:
		if err := json.Unmarshal(m.Data, &data); err != nil {
			l.t.Fatal(err)
		}
		return m.Name, data, true
	case <-time.After(300 * time.Millisecond):
		return "", nil, false
	}
}

// quiet fails when a message arrives.
func (l *listener) quiet() {
	l.t.Helper()
	if topic, data, ok := l.next(); ok {
		l.t.Fatalf("unexpected %s %v", topic, data)
	}
}

// deliver sends the news collected so far.
func deliver(app core.App) {
	changes(app).deliver(app)
	sightings(app).deliver(app)
}

func TestRoomNewsReachMembersWithWhatEachMaySee(t *testing.T) {
	app := newTestApp(t)
	lead, mate, outsider := newUser(t, app, "Lead"), newUser(t, app, "Mate"), newUser(t, app, "Outsider")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	shared := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Shared", "server": "Lumiel", "region": "GLOBAL_EU"})
	private := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Private", "server": "Lumiel", "region": "GLOBAL_EU"})
	membership := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter", "sharedCharacters": []string{shared.Id}})
	deliver(app)
	topic := roomTopic + room.Id
	leads, mates, outsiders := listen(t, app, lead, topic), listen(t, app, mate, topic), listen(t, app, outsider, topic)

	// A reading of each character: the lead hears only of the shared one, its owner of both.
	for _, c := range []*core.Record{shared, private} {
		c.Set("value", 120)
		c.Set("confirmed", true)
		if err := app.Save(c); err != nil {
			t.Fatal(err)
		}
	}
	deliver(app)
	names := func(data map[string]any) []string {
		out := []string{}
		for _, raw := range data["characters"].([]any) {
			out = append(out, raw.(map[string]any)["characterName"].(string))
		}
		return out
	}
	if _, data, ok := leads.next(); !ok || data["refresh"] != true || len(names(data)) != 1 || names(data)[0] != "Shared" {
		t.Fatalf("the lead heard %v", data)
	}
	if _, data, ok := mates.next(); !ok || len(names(data)) != 2 {
		t.Fatalf("the owner heard %v", data)
	}
	outsiders.quiet()

	// A change nobody sees (the portrait job's check) is no news.
	checked, _ := app.FindRecordById("characters", shared.Id)
	checked.Set("portraitCheckedAt", now())
	if err := app.Save(checked); err != nil {
		t.Fatal(err)
	}
	deliver(app)
	leads.quiet()

	// Structural changes are one refresh for everyone in the room, however many.
	notify(app, []string{room.Id})
	notify(app, []string{room.Id})
	deliver(app)
	for _, l := range []*listener{leads, mates} {
		if _, data, ok := l.next(); !ok || data["refresh"] != true || data["characters"] != nil {
			t.Fatalf("a refresh: %v", data)
		}
		l.quiet()
	}

	// A removed member hears once that it was removed, and nothing after that.
	if err := app.Delete(membership); err != nil {
		t.Fatal(err)
	}
	deliver(app)
	if _, data, ok := mates.next(); !ok || data["removed"] != true {
		t.Fatalf("the removed member heard %v", data)
	}
	if mates.client.HasSubscription(topic) {
		t.Fatal("the removed member is still subscribed")
	}
	if _, data, ok := leads.next(); !ok || data["refresh"] != true || data["removed"] != nil {
		t.Fatalf("the lead heard %v", data)
	}
	notify(app, []string{room.Id})
	deliver(app)
	mates.quiet()
}

func TestOwnNewsReachOnlyTheAccount(t *testing.T) {
	app := newTestApp(t)
	user, other := newUser(t, app, "Owner"), newUser(t, app, "Other")
	mine := listen(t, app, user, userTopic+user.Id)
	// Another account subscribed to this one's topic hears nothing.
	nosy := listen(t, app, other, userTopic+user.Id)
	saved(t, app, "user_tasks", map[string]any{"user": user.Id, "title": "Daily dungeon", "cadence": "daily", "position": 1})
	deliver(app)
	if _, data, ok := mine.next(); !ok || data["refresh"] != true {
		t.Fatalf("a new task: %v", data)
	}
	nosy.quiet()
	c := saved(t, app, "characters", map[string]any{"user": user.Id, "characterName": "Mine", "server": "Lumiel", "region": "GLOBAL_EU"})
	deliver(app)
	mine.next() // the new character
	c.Set("value", 300)
	if err := app.Save(c); err != nil {
		t.Fatal(err)
	}
	deliver(app)
	if _, data, ok := mine.next(); !ok || data["refresh"] != nil || len(data["characters"].([]any)) != 1 {
		t.Fatalf("a reading: %v", data)
	}
	// The hourly activity mark is no news; a new display name is.
	account, _ := app.FindRecordById("users", user.Id)
	account.Set("lastActiveAt", now())
	if err := app.Save(account); err != nil {
		t.Fatal(err)
	}
	deliver(app)
	mine.quiet()
	account, _ = app.FindRecordById("users", user.Id)
	account.Set("displayName", "Renamed")
	if err := app.Save(account); err != nil {
		t.Fatal(err)
	}
	deliver(app)
	if _, data, ok := mine.next(); !ok || data["refresh"] != true {
		t.Fatalf("a new display name: %v", data)
	}
}

func TestHeartbeatsReachRoomsAndAreWrittenLater(t *testing.T) {
	app := newTestApp(t)
	lead, reader := newUser(t, app, "Lead"), newUser(t, app, "Reader")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	session := saved(t, app, "publisher_sessions", map[string]any{"user": reader.Id, "expiresAt": expiry(86400)})
	shared := saved(t, app, "characters", map[string]any{"user": reader.Id, "characterName": "Shared", "server": "Lumiel", "region": "GLOBAL_EU", "valid": true, "confirmed": true, "readingSession": session.Id, "lastSeenAt": ago(time.Minute)})
	private := saved(t, app, "characters", map[string]any{"user": reader.Id, "characterName": "Private", "server": "Lumiel", "region": "GLOBAL_EU", "valid": true, "confirmed": true, "readingSession": session.Id, "lastSeenAt": ago(time.Minute)})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": reader.Id, "role": "reporter", "sharedCharacters": []string{shared.Id}})
	deliver(app)
	leads := listen(t, app, lead, presenceTopic+room.Id)
	own := listen(t, app, reader, userTopic+reader.Id)

	at := time.Now()
	beat(app, session, shared, at)
	beat(app, session, private, at)
	deliver(app)
	if _, data, ok := leads.next(); !ok || len(data["seen"].(map[string]any)) != 1 || data["seen"].(map[string]any)[shared.Id] != iso(at) {
		t.Fatalf("the room heard %v", data)
	}
	if _, data, ok := own.next(); !ok || len(data["seen"].(map[string]any)) != 2 || data["contact"].(map[string]any)[session.Id] != iso(at) {
		t.Fatalf("the owner heard %v", data)
	}

	// Answers show the heartbeat before it is written.
	stored, _ := app.FindRecordById("characters", shared.Id)
	if stored.GetDateTime("lastSeenAt").Time().After(at.Add(-30 * time.Second)) {
		t.Fatal("the heartbeat was written at once")
	}
	present(app, stored)
	if stored.GetString("lastSeenAt") != stamp(at) {
		t.Fatalf("answered lastSeenAt %s, want %s", stored.GetString("lastSeenAt"), stamp(at))
	}

	// Written later in one go; a character another session took over meanwhile keeps its own.
	other := saved(t, app, "publisher_sessions", map[string]any{"user": reader.Id, "expiresAt": expiry(86400)})
	taken, _ := app.FindRecordById("characters", private.Id)
	taken.Set("readingSession", other.Id)
	taken.Set("lastSeenAt", ago(time.Hour))
	if err := app.Save(taken); err != nil {
		t.Fatal(err)
	}
	if err := presenceOf(app).write(app); err != nil {
		t.Fatal(err)
	}
	written, _ := app.FindRecordById("characters", shared.Id)
	kept, _ := app.FindRecordById("characters", private.Id)
	contacted, _ := app.FindRecordById("publisher_sessions", session.Id)
	if written.GetString("lastSeenAt") != stamp(at) || kept.GetDateTime("lastSeenAt").Time().After(time.Now().Add(-59*time.Minute)) || contacted.GetString("updated") != stamp(at) {
		t.Fatalf("written %s, kept %s, session contact %s", written.GetString("lastSeenAt"), kept.GetString("lastSeenAt"), contacted.GetString("updated"))
	}
	if got := contactAt(app, contacted); got != stamp(at) {
		t.Fatalf("contact %s", got)
	}
	// A later reading is never set back by an older heartbeat.
	written.Set("lastSeenAt", now())
	if err := app.Save(written); err != nil {
		t.Fatal(err)
	}
	beat(app, session, written, at)
	if err := presenceOf(app).write(app); err != nil {
		t.Fatal(err)
	}
	if again, _ := app.FindRecordById("characters", shared.Id); again.GetString("lastSeenAt") == stamp(at) {
		t.Fatal("an older heartbeat overwrote a later reading")
	}
}
