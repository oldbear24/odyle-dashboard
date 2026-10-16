package odyle

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

// Realtime. Clients subscribe through PocketBase's /api/realtime to:
//
//   - odyle.room.<room id>, members only: {"refresh": true} when anything in the room
//     changed; {"refresh": true, "characters": […]} when only characters did (in their
//     snapshot form, each with shared); {"refresh": true, "removed": true} to a member
//     who left or was removed, whose clients are then unsubscribed from the room.
//   - odyle.presence.<room id>, members only: {"seen": {<character id>: <lastSeenAt>}}
//     as the room's readers send heartbeats.
//   - odyle.user.<account id>, that account only: {"refresh": true} when its own
//     characters, rooms, tasks, Windows apps or profile changed, {"characters": […]}
//     when only its characters did, and {"seen": {…}, "contact": {<reader session id>:
//     <time>}} for its readers' heartbeats. News for everyone comes on each account's topic
//     too: {"release": {version, publishedAt, url}} when a newer Windows release is out and
//     {"announcement": {text, level} | null} when the announcement changed.
//
// Every room message carries "refresh", so a dashboard that only knows to fetch the
// snapshot again keeps working. Changes are collected and delivered together a moment
// later (presence every two seconds), so a burst of changes is one message, and each
// delivery reads a room's members once: who hears it and which characters each of them
// may see. Messages go out without waiting for slow clients.
const roomTopic, presenceTopic, userTopic, adminTopic = "odyle.room.", "odyle.presence.", "odyle.user.", "odyle.admin."

const changesDelay, presenceDelay = 150 * time.Millisecond, 2 * time.Second

// sighting is a character's heartbeat: whose character it is and when.
type sighting struct {
	owner string
	at    time.Time
}

type roomNews struct {
	refresh    bool
	characters map[string]*Character // the latest copy of each changed character
	removed    map[string]bool       // accounts that left or were removed
	seen       map[string]sighting
}

type userNews struct {
	refresh    bool
	characters map[string]*Character
	seen       map[string]time.Time // its characters' heartbeats
	contact    map[string]time.Time // its reader sessions' heartbeats
}

// outbox collects news until its delivery.
type outbox struct {
	delay     time.Duration
	mu        sync.Mutex
	scheduled bool
	rooms     map[string]*roomNews
	users     map[string]*userNews
}

func newOutbox(delay time.Duration) *outbox {
	return &outbox{delay: delay, rooms: map[string]*roomNews{}, users: map[string]*userNews{}}
}

func (o *outbox) room(app core.App, id string, change func(*roomNews)) {
	if id == "" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	n := o.rooms[id]
	if n == nil {
		n = &roomNews{characters: map[string]*Character{}, removed: map[string]bool{}, seen: map[string]sighting{}}
		o.rooms[id] = n
	}
	change(n)
	o.schedule(app)
}

func (o *outbox) user(app core.App, id string, change func(*userNews)) {
	if id == "" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	n := o.users[id]
	if n == nil {
		n = &userNews{characters: map[string]*Character{}, seen: map[string]time.Time{}, contact: map[string]time.Time{}}
		o.users[id] = n
	}
	change(n)
	o.schedule(app)
}

// schedule plans the delivery (with o.mu held).
func (o *outbox) schedule(app core.App) {
	if o.scheduled {
		return
	}
	o.scheduled = true
	root := stateOf(app).root
	if root == nil {
		root = app
	}
	time.AfterFunc(o.delay, func() { o.deliver(root) })
}

// deliver sends everything collected so far.
func (o *outbox) deliver(app core.App) {
	o.mu.Lock()
	rooms, users := o.rooms, o.users
	o.rooms, o.users, o.scheduled = map[string]*roomNews{}, map[string]*userNews{}, false
	o.mu.Unlock()
	defer func() {
		if r := recover(); r != nil {
			warn(app, "Odyle realtime delivery failed", "error", fmt.Sprint(r))
		}
	}()
	if len(rooms)+len(users) == 0 {
		return
	}
	clients := app.SubscriptionsBroker().Clients()
	for id, n := range rooms {
		if err := deliverRoom(app, clients, id, n); err != nil {
			warn(app, "Odyle realtime delivery failed", "room", id, "error", err.Error())
		}
	}
	for id, n := range users {
		deliverUser(clients, id, n)
	}
}

// clientAccount is the account a realtime client signed in with, or "".
func clientAccount(c subscriptions.Client) string {
	auth, _ := c.Get(apis.RealtimeClientAuthKey).(*core.Record)
	if auth == nil || auth.Collection().Name != "users" {
		return ""
	}
	return auth.Id
}

// post sends a message without waiting for the client to take it.
func post(c subscriptions.Client, topic string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	go func() {
		defer func() { recover() }() // the client went away meanwhile
		c.Send(subscriptions.Message{Name: topic, Data: raw})
	}()
}

func iso(at time.Time) string { return at.UTC().Format(isoLayout) }

func deliverRoom(app core.App, clients map[string]subscriptions.Client, id string, n *roomNews) error {
	topic, presence := roomTopic+id, presenceTopic+id
	var listeners []subscriptions.Client
	for _, c := range clients {
		if c.HasSubscription(topic) || c.HasSubscription(presence) {
			listeners = append(listeners, c)
		}
	}
	if len(listeners) == 0 {
		return nil
	}
	members, err := roomMembers(app, id)
	if err != nil {
		return err
	}
	shares := make(map[string][]string, len(members)) // account → the characters it shares here
	for _, m := range members {
		shares[m.User()] = m.Shared()
	}
	exports := map[string]map[string]any{}
	for characterId, c := range n.characters {
		j := c.PublicExport()
		j["shared"] = contains(shares[c.User()], characterId)
		exports[characterId] = j
	}
	for _, c := range listeners {
		viewer := clientAccount(c)
		if viewer == "" {
			continue
		}
		if _, member := shares[viewer]; !member {
			if n.removed[viewer] {
				if c.HasSubscription(topic) {
					post(c, topic, map[string]any{"refresh": true, "removed": true})
				}
				c.Unsubscribe(topic, presence)
			}
			continue
		}
		visible := func(owner, characterId string) bool { return owner == viewer || contains(shares[owner], characterId) }
		if c.HasSubscription(topic) {
			if n.refresh {
				post(c, topic, map[string]any{"refresh": true})
			} else if len(n.characters) > 0 {
				changed := []any{}
				for characterId, character := range n.characters {
					if visible(character.User(), characterId) {
						changed = append(changed, exports[characterId])
					}
				}
				if len(changed) > 0 {
					post(c, topic, map[string]any{"refresh": true, "characters": changed})
				}
			}
		}
		if c.HasSubscription(presence) && len(n.seen) > 0 {
			seen := map[string]string{}
			for characterId, s := range n.seen {
				if visible(s.owner, characterId) {
					seen[characterId] = iso(s.at)
				}
			}
			if len(seen) > 0 {
				post(c, presence, map[string]any{"seen": seen})
			}
		}
	}
	return nil
}

func deliverUser(clients map[string]subscriptions.Client, id string, n *userNews) {
	topic := userTopic + id
	message := map[string]any{}
	if n.refresh {
		message["refresh"] = true
	} else if len(n.characters) > 0 {
		changed := []any{}
		for _, c := range n.characters {
			changed = append(changed, c.PublicExport())
		}
		message["characters"] = changed
	}
	for _, kind := range []struct {
		key   string
		times map[string]time.Time
	}{{"seen", n.seen}, {"contact", n.contact}} {
		if len(kind.times) > 0 {
			times := map[string]string{}
			for k, at := range kind.times {
				times[k] = iso(at)
			}
			message[kind.key] = times
		}
	}
	if len(message) == 0 {
		return
	}
	for _, c := range clients {
		if c.HasSubscription(topic) && clientAccount(c) == id {
			post(c, topic, message)
		}
	}
}

// tellEveryone tells every signed-in client, on its own account's topic, news that concerns
// everyone: a new Windows release or a changed announcement. Clients that know no such key
// ignore it.
func tellEveryone(app core.App, message map[string]any) {
	for _, c := range app.SubscriptionsBroker().Clients() {
		if id := clientAccount(c); id != "" && c.HasSubscription(userTopic+id) {
			post(c, userTopic+id, message)
		}
	}
}

// changes are delivered at once (150 ms), heartbeats every two seconds.
func changes(app core.App) *outbox   { return stateOf(app).changes }
func sightings(app core.App) *outbox { return stateOf(app).sightings }

// notify tells the rooms' members to fetch their snapshot again.
func notify(app core.App, roomIds []string) {
	for _, id := range unique(roomIds) {
		changes(app).room(app, id, func(n *roomNews) { n.refresh = true })
	}
}

// notifyUsers tells the accounts to fetch their own data again.
func notifyUsers(app core.App, userIds ...string) {
	for _, id := range unique(userIds) {
		changes(app).user(app, id, func(n *userNews) { n.refresh = true })
	}
}

// characterChanged sends a changed character to its owner and to every room the owner
// is in; each member hears of it only if they may see it.
func characterChanged(app core.App, c *Character) {
	owner, copy := c.User(), viewOf[Character](c.Clone())
	present(app, copy)
	roomIds, err := roomsFor(app, owner)
	if err != nil {
		warn(app, "Odyle realtime delivery failed", "character", c.Id, "error", err.Error())
	}
	for _, id := range unique(roomIds) {
		changes(app).room(app, id, func(n *roomNews) { n.characters[copy.Id] = copy })
	}
	changes(app).user(app, owner, func(n *userNews) { n.characters[copy.Id] = copy })
}

// characterFields are the fields of a character clients show; a change to any other
// (the portrait job's portraitCheckedAt, say) is not news.
var characterFields = []string{"characterName", "server", "region", "value", "confirmed", "valid", "source", "parserVersion", "lastReadingAt", "lastSeenAt", "portrait", "parts", "regenTick", "naturalMax"}

func visiblyChanged(c *core.Record) bool {
	before := c.Original()
	for _, f := range characterFields {
		if fmt.Sprint(before.Get(f)) != fmt.Sprint(c.Get(f)) {
			return true
		}
	}
	return false
}

// watchChanges turns record changes into news, whatever made them: the Odyle routes,
// the jobs or a superuser in the PocketBase dashboard.
func watchChanges(app core.App) {
	app.OnRecordAfterCreateSuccess("characters").BindFunc(func(e *core.RecordEvent) error {
		characterChanged(e.App, viewOf[Character](e.Record))
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("characters").BindFunc(func(e *core.RecordEvent) error {
		if visiblyChanged(e.Record) {
			characterChanged(e.App, viewOf[Character](e.Record))
		}
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("characters").BindFunc(func(e *core.RecordEvent) error {
		owner := viewOf[Character](e.Record).User()
		if roomIds, err := roomsFor(e.App, owner); err == nil {
			notify(e.App, roomIds)
		}
		notifyUsers(e.App, owner)
		return e.Next()
	})
	member := func(e *core.RecordEvent) error {
		m := viewOf[Member](e.Record)
		notify(e.App, []string{m.Room()})
		notifyUsers(e.App, m.User())
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("room_members").BindFunc(member)
	app.OnRecordAfterUpdateSuccess("room_members").BindFunc(member)
	app.OnRecordAfterDeleteSuccess("room_members").BindFunc(func(e *core.RecordEvent) error {
		m := viewOf[Member](e.Record)
		user := m.User()
		changes(e.App).room(e.App, m.Room(), func(n *roomNews) { n.refresh, n.removed[user] = true, true })
		notifyUsers(e.App, user)
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("party_rooms").BindFunc(func(e *core.RecordEvent) error {
		notify(e.App, []string{e.Record.Id})
		if members, err := roomMembers(e.App, e.Record.Id); err == nil {
			notifyUsers(e.App, pluck(members, (*Member).User)...)
		}
		return e.Next()
	})
	inRoom := func(e *core.RecordEvent) error {
		notify(e.App, []string{e.Record.GetString("room")})
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("room_wishes", "room_runs").BindFunc(inRoom)
	app.OnRecordAfterUpdateSuccess("room_wishes", "room_runs").BindFunc(inRoom)
	app.OnRecordAfterDeleteSuccess("room_wishes", "room_runs").BindFunc(inRoom)
	own := func(e *core.RecordEvent) error {
		notifyUsers(e.App, e.Record.GetString("user"))
		return e.Next()
	}
	app.OnRecordAfterCreateSuccess("user_tasks", "publisher_sessions", "desktop_devices").BindFunc(own)
	app.OnRecordAfterUpdateSuccess("user_tasks", "desktop_devices").BindFunc(own)
	app.OnRecordAfterDeleteSuccess("user_tasks", "publisher_sessions", "desktop_devices").BindFunc(own)
	// A new display name; the hourly activity mark (touch) is no news.
	app.OnRecordAfterUpdateSuccess("users").BindFunc(func(e *core.RecordEvent) error {
		if viewOf[Account](e.Record.Original()).DisplayName() != viewOf[Account](e.Record).DisplayName() {
			notifyUsers(e.App, e.Record.Id)
		}
		return e.Next()
	})
}

// watchSubscriptions lets only members subscribe to a room's topics, only the account
// itself to its own and only superusers to the admin topics; deliveries check the
// sign-in again, so a client signed out meanwhile hears nothing more.
func watchSubscriptions(app core.App) {
	app.OnRealtimeSubscribeRequest().BindFunc(func(e *core.RealtimeSubscribeRequestEvent) error {
		for _, topic := range e.Subscriptions {
			room, isRoom := strings.CutPrefix(topic, roomTopic)
			if !isRoom {
				room, isRoom = strings.CutPrefix(topic, presenceTopic)
			}
			user, isUser := strings.CutPrefix(topic, userTopic)
			switch {
			case isRoom:
				if e.Auth == nil || e.Auth.Collection().Name != "users" {
					return apis.NewForbiddenError("", nil)
				}
				if _, err := membership(e.App, e.Auth.Id, room); err != nil {
					return err
				}
			case isUser:
				if e.Auth == nil || e.Auth.Collection().Name != "users" || e.Auth.Id != user {
					return apis.NewForbiddenError("", nil)
				}
			case strings.HasPrefix(topic, adminTopic):
				if e.Auth == nil || !e.Auth.IsSuperuser() {
					return apis.NewForbiddenError("", nil)
				}
			}
		}
		return e.Next()
	})
	app.OnRealtimeMessageSend().BindFunc(func(e *core.RealtimeMessageEvent) error {
		name := e.Message.Name
		if !strings.HasPrefix(name, "odyle.") {
			return e.Next()
		}
		auth, _ := e.Client.Get(apis.RealtimeClientAuthKey).(*core.Record)
		switch {
		case strings.HasPrefix(name, adminTopic):
			if auth == nil || !auth.IsSuperuser() {
				return nil
			}
		case strings.HasPrefix(name, userTopic):
			if clientAccount(e.Client) == "" || name != userTopic+clientAccount(e.Client) {
				return nil
			}
		default:
			if clientAccount(e.Client) == "" {
				return nil
			}
		}
		return e.Next()
	})
}
