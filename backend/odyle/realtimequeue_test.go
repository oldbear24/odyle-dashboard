package odyle

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/subscriptions"
)

// A connection gets its messages in the order they were posted.
func TestPostKeepsOrder(t *testing.T) {
	c := subscriptions.NewDefaultClient()
	got := make(chan int, 500)
	go func() {
		for m := range c.Channel() {
			var data map[string]int
			_ = json.Unmarshal(m.Data, &data)
			got <- data["n"]
		}
	}()
	defer c.Discard()
	// In batches the queue holds without collapsing; between them the sender stops and starts.
	for batch := range 10 {
		for n := range queueLimit {
			post(c, "odyle.user.a", map[string]int{"n": batch*queueLimit + n})
		}
		for n := range queueLimit {
			select {
			case got := <-got:
				if want := batch*queueLimit + n; got != want {
					t.Fatalf("message %d came as %d", want, got)
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("message %d never came", batch*queueLimit+n)
			}
		}
	}
}

// A connection that takes nothing holds a bounded queue: its messages collapse into one per
// topic, refresh on room and account topics, with notices kept and heartbeats merged, and the
// order of the topics kept.
func TestStalledQueueCollapses(t *testing.T) {
	c := subscriptions.NewDefaultClient()
	room, user, presence := roomTopic+"r1", userTopic+"u1", presenceTopic+"r1"
	post(c, room, map[string]any{"refresh": true, "characters": []any{map[string]any{"id": "c0"}}}) // taken by the sender, which then waits
	time.Sleep(20 * time.Millisecond)
	lastSeen := map[string]any{}
	for n := range 3 * queueLimit {
		switch n % 3 {
		case 0:
			post(c, room, map[string]any{"refresh": true, "characters": []any{map[string]any{"id": fmt.Sprint("c", n)}}})
		case 1:
			lastSeen[fmt.Sprint("c", n%7)] = fmt.Sprint(n)
			post(c, presence, map[string]any{"seen": map[string]any{fmt.Sprint("c", n%7): fmt.Sprint(n)}})
		case 2:
			message := map[string]any{"characters": []any{map[string]any{"id": "mine"}}, "partyReady": []any{map[string]any{"runId": fmt.Sprint(n)}}}
			if n == 5 {
				message["announcement"] = map[string]any{"text": "Maintenance", "level": "info"}
			}
			if n == 3*queueLimit-1 {
				message["announcement"] = nil
			}
			post(c, user, message)
		}
	}
	if n := outgoing.waiting(c.Id()); n > queueLimit {
		t.Fatalf("%d messages wait", n)
	}
	read := func(wait time.Duration) (string, map[string]any) {
		t.Helper()
		select {
		case m := <-c.Channel():
			var data map[string]any
			if err := json.Unmarshal(m.Data, &data); err != nil {
				t.Fatal(err)
			}
			return m.Name, data
		case <-time.After(wait):
			return "", nil
		}
	}
	if topic, data := read(5 * time.Second); topic != room || data["characters"] == nil {
		t.Fatalf("first %s %v", topic, data)
	}
	// The queue collapsed when it passed the limit, then took new messages after the collapsed
	// ones; whatever it holds now, each topic's news is all there in order.
	partyReady, seen, refreshed, cleared := 0, map[string]any{}, map[string]bool{}, false
	for {
		topic, data := read(300 * time.Millisecond)
		if topic == "" {
			break
		}
		switch topic {
		case room:
			refreshed[topic] = refreshed[topic] || data["refresh"] == true && data["characters"] == nil
		case user:
			if data["refresh"] == true && data["characters"] == nil {
				refreshed[topic] = true
			}
			list, _ := data["partyReady"].([]any)
			partyReady += len(list)
			if a, ok := data["announcement"]; ok && a == nil {
				cleared = true
			}
		case presence:
			for k, v := range data["seen"].(map[string]any) {
				seen[k] = v
			}
		}
	}
	if !refreshed[room] || !refreshed[user] {
		t.Fatalf("refreshed %v", refreshed)
	}
	if partyReady != queueLimit {
		t.Fatalf("%d party notices, want %d", partyReady, queueLimit)
	}
	if !cleared {
		t.Fatal("the cleared announcement was lost")
	}
	if fmt.Sprint(seen) != fmt.Sprint(lastSeen) {
		t.Fatalf("seen %v, want %v", seen, lastSeen)
	}
	c.Discard()
}

func TestCollapseQueue(t *testing.T) {
	message := func(topic string, data any) subscriptions.Message {
		raw, _ := json.Marshal(data)
		return subscriptions.Message{Name: topic, Data: raw}
	}
	out := collapseQueue([]subscriptions.Message{
		message(userTopic+"u", map[string]any{"seen": map[string]any{"a": "1"}, "windowsBlocked": []any{"1.0.0"}, "achievements": []any{"x"}}),
		message(roomTopic+"r", map[string]any{"refresh": true, "removed": true}),
		message(adminTopic+"packets", map[string]any{"packet": 1}),
		message(userTopic+"u", map[string]any{"seen": map[string]any{"b": "2"}, "windowsBlocked": []any{"2.0.0"}, "achievements": []any{"y"}, "windowsUpdate": map[string]any{"at": "now"}}),
		message(roomTopic+"r", map[string]any{"refresh": true, "characters": []any{"c"}}),
		message(adminTopic+"packets", map[string]any{"packet": 2}),
	})
	got := []string{}
	for _, m := range out {
		got = append(got, m.Name+" "+string(m.Data))
	}
	want := []string{
		userTopic + `u {"achievements":["x","y"],"refresh":true,"seen":{"a":"1","b":"2"},"windowsBlocked":["2.0.0"],"windowsUpdate":{"at":"now"}}`,
		roomTopic + `r {"refresh":true,"removed":true}`,
		adminTopic + `packets {"packet":2}`,
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("collapsed\n%v\nwant\n%v", got, want)
	}
}

// The Server monitor's packets go to the superusers watching it and to nobody else, and no
// connection is looked at while none watches.
func TestPacketsReachOnlyWatchingSuperusers(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Player")
	l := listen(t, app, player, userTopic+player.Id, packetTopic) // a player cannot subscribe to it; even so
	broadcast(app, newObject().set("kind", "report"))
	l.quiet()
	admin := subscriptions.NewDefaultClient()
	admin.Subscribe(packetTopic)
	app.SubscriptionsBroker().Register(admin)
	stateOf(app).admins.add(admin)
	broadcast(app, newObject().set("kind", "report"))
	select {
	case m := <-admin.Channel():
		if m.Name != packetTopic {
			t.Fatalf("got %s", m.Name)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the superuser heard nothing")
	}
	l.quiet()
	admin.Unsubscribe()
	if n := len(stateOf(app).admins.listening(packetTopic)); n != 0 {
		t.Fatalf("%d still listen", n)
	}
}

// Realtime connections are capped per client address as PocketBase reads it with the trusted
// proxy settings, never per socket address, and private addresses are not capped.
func TestRealtimeConnectionsCappedPerAddress(t *testing.T) {
	app := newTestApp(t)
	t.Setenv("ODYLE_REALTIME_PER_ADDRESS", "2")
	settings, _ := app.Settings().Clone()
	settings.TrustedProxy = core.TrustedProxyConfig{Headers: []string{"X-Real-IP"}}
	if err := app.Save(settings); err != nil {
		t.Fatal(err)
	}
	release := make(chan struct{})
	defer close(release)
	open := func(remote, header string) error {
		req := httptest.NewRequest(http.MethodGet, "/api/realtime", nil)
		req.RemoteAddr = remote + ":5555"
		if header != "" {
			req.Header.Set("X-Real-IP", header)
		}
		e := &core.RealtimeConnectRequestEvent{RequestEvent: &core.RequestEvent{App: app, Event: router.Event{Request: req, Response: httptest.NewRecorder()}}, Client: subscriptions.NewDefaultClient()}
		started, result := make(chan struct{}), make(chan error, 1)
		go func() {
			result <- app.OnRealtimeConnectRequest().Trigger(e, func(*core.RealtimeConnectRequestEvent) error {
				close(started)
				<-release
				return nil
			})
		}()
		select {
		case <-started:
			return nil
		case err := <-result:
			return err
		}
	}
	// Behind the proxy (one socket address), each player has their own budget.
	for _, player := range []string{"203.0.113.7", "203.0.113.7", "198.51.100.1", "198.51.100.1"} {
		if err := open("10.0.0.2", player); err != nil {
			t.Fatalf("%s refused: %v", player, err)
		}
	}
	if err := open("10.0.0.2", "203.0.113.7"); err == nil {
		t.Fatal("a third connection from one address was taken")
	} else if apiErr, ok := err.(*router.ApiError); !ok || apiErr.Status != http.StatusTooManyRequests {
		t.Fatalf("refused with %v", err)
	}
	// A proxy whose header is missing is a private address: never capped.
	for range 3 {
		if err := open("10.0.0.2", ""); err != nil {
			t.Fatalf("the proxy's own address was refused: %v", err)
		}
	}
	// A connection that ends frees its place.
	counts := &stateOf(app).realtimeAddresses
	counts.release("203.0.113.7")
	if err := open("10.0.0.2", "203.0.113.7"); err != nil {
		t.Fatalf("refused after one ended: %v", err)
	}
}
