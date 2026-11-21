package odyle

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"sync"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/subscriptions"
)

// Realtime fan-out (#180). Each delivery indexes the open connections by topic once
// (indexClients), so news for many rooms and accounts no longer scans every connection per
// room. A connection's messages wait in its own queue and one goroutine hands them over in
// order, so a stalled client holds one goroutine, not one per message, and two deliveries
// never swap places. A queue that grows past queueLimit (the client takes nothing) collapses:
// each topic's messages become one, {"refresh": true} on room and account topics (both
// clients fetch again on it), with the notices and news for everyone it held kept, and the
// heartbeats merged. Connections are capped per client address (realtimeAddresses).

// clientIndex maps each Odyle topic to the connections subscribed to it.
type clientIndex map[string][]subscriptions.Client

// indexClients indexes the connections by their Odyle topics, once per delivery.
func indexClients(clients map[string]subscriptions.Client) clientIndex {
	index := clientIndex{}
	for _, c := range clients {
		for topic := range c.Subscriptions("odyle.") {
			index[topic] = append(index[topic], c)
		}
	}
	return index
}

// queueLimit is how many messages wait for one connection before they collapse. A delivery
// sends a connection at most one message per topic, every 150 ms at the most.
const queueLimit = 64

// senders are the connections with messages waiting, by connection id; each has one
// goroutine handing them over (drain) while its queue is not empty.
type senders struct {
	mu     sync.Mutex
	queues map[string]*sendQueue
}

type sendQueue struct{ messages []subscriptions.Message }

var outgoing = &senders{queues: map[string]*sendQueue{}}

// push queues a message for a connection and starts its sender when none runs.
func (s *senders) push(c subscriptions.Client, m subscriptions.Message) {
	id := c.Id()
	s.mu.Lock()
	q, running := s.queues[id]
	if !running {
		q = &sendQueue{}
		s.queues[id] = q
	}
	q.messages = append(q.messages, m)
	if len(q.messages) > queueLimit {
		q.messages = collapseQueue(q.messages)
	}
	s.mu.Unlock()
	if !running {
		go s.drain(c, q)
	}
}

// drain hands a connection its messages in order, one at a time, until none waits or the
// connection went away.
func (s *senders) drain(c subscriptions.Client, q *sendQueue) {
	for {
		s.mu.Lock()
		if len(q.messages) == 0 || c.IsDiscarded() {
			delete(s.queues, c.Id())
			s.mu.Unlock()
			return
		}
		m := q.messages[0]
		q.messages[0] = subscriptions.Message{}
		q.messages = q.messages[1:]
		s.mu.Unlock()
		c.Send(m) // returns at once once the client is discarded
	}
}

// waiting is how many messages wait for a connection (tests).
func (s *senders) waiting(id string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if q := s.queues[id]; q != nil {
		return len(q.messages)
	}
	return 0
}

// Keys of a collapsed message: lists of notices add up, heartbeats merge, a room's removal
// stands only when the latest message says it, characters give way to refresh; anything else
// (news for everyone, notification settings) is the latest.
var (
	addedUp = map[string]bool{"capAlerts": true, "partyReady": true, "invites": true, "achievements": true}
	merged  = map[string]bool{"seen": true, "contact": true}
)

// collapseQueue turns queued messages into one per topic, in the order the topics first came.
func collapseQueue(messages []subscriptions.Message) []subscriptions.Message {
	order, bodies := []string{}, map[string]map[string]any{}
	for _, m := range messages {
		into := bodies[m.Name]
		if into == nil {
			into = map[string]any{}
			bodies[m.Name] = into
			order = append(order, m.Name)
		}
		var data map[string]any
		if json.Unmarshal(m.Data, &data) != nil {
			continue
		}
		for key, value := range data {
			switch {
			case addedUp[key]:
				before, _ := into[key].([]any)
				list, _ := value.([]any)
				into[key] = append(before, list...)
			case merged[key]:
				before, _ := into[key].(map[string]any)
				if before == nil {
					before = map[string]any{}
				}
				next, _ := value.(map[string]any)
				for k, v := range next {
					before[k] = v
				}
				into[key] = before
			case key == "removed":
				// Below: the latest message decides.
			default:
				into[key] = value
			}
		}
		// A removal unsubscribes the client from the room, so news after it means the member was
		// added again (and subscribed again): only the latest message says whether it is removed.
		if data["removed"] == true {
			into["removed"] = true
		} else {
			delete(into, "removed")
		}
	}
	out := make([]subscriptions.Message, 0, len(order))
	for _, topic := range order {
		body := bodies[topic]
		if strings.HasPrefix(topic, roomTopic) || strings.HasPrefix(topic, userTopic) {
			body["refresh"] = true
			delete(body, "characters")
		}
		raw, err := json.Marshal(body)
		if err != nil {
			continue
		}
		out = append(out, subscriptions.Message{Name: topic, Data: raw})
	}
	return out
}

// realtimePerAddress caps the realtime connections open from one client address, the one
// PocketBase's RealIP answers with the trusted proxy settings (proxy.go), like the rate limits.
// Each dashboard tab and each Windows app holds one, and a household or a LAN party shares an
// address, so the cap is generous; ODYLE_REALTIME_PER_ADDRESS changes it (0 turns it off).
// Private and loopback addresses are never capped: they are a proxy's whose trusted header is
// not set (every player would share them) or a LAN's.
const defaultRealtimePerAddress = 200

func realtimePerAddress() int {
	if raw, set := os.LookupEnv("ODYLE_REALTIME_PER_ADDRESS"); set {
		if n, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && n >= 0 {
			return n
		}
	}
	return defaultRealtimePerAddress
}

// addressCounts counts the open realtime connections per client address.
type addressCounts struct {
	mu   sync.Mutex
	open map[string]int
}

// take counts a connection from the address, unless limit are open already.
func (a *addressCounts) take(address string, limit int) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.open == nil {
		a.open = map[string]int{}
	}
	if a.open[address] >= limit {
		return false
	}
	a.open[address]++
	return true
}

func (a *addressCounts) release(address string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.open[address] <= 1 {
		delete(a.open, address)
	} else {
		a.open[address]--
	}
}

// adminListeners are the connections that subscribed to a superusers' topic, so the Server
// monitor's packets go to them without looking at every connection, and nowhere while no
// superuser watches.
type adminListeners struct {
	mu      sync.Mutex
	clients map[string]subscriptions.Client
}

func (a *adminListeners) add(c subscriptions.Client) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.clients == nil {
		a.clients = map[string]subscriptions.Client{}
	}
	a.clients[c.Id()] = c
}

// listening are the connections subscribed to topic now; those gone or no longer subscribed
// to any superusers' topic are forgotten.
func (a *adminListeners) listening(topic string) []subscriptions.Client {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := []subscriptions.Client{}
	for id, c := range a.clients {
		if c.IsDiscarded() || len(c.Subscriptions(adminTopic)) == 0 {
			delete(a.clients, id)
			continue
		}
		if c.HasSubscription(topic) {
			out = append(out, c)
		}
	}
	return out
}

// watchRealtimeConnections caps the connections per client address.
func watchRealtimeConnections(app core.App) {
	app.OnRealtimeConnectRequest().BindFunc(func(e *core.RealtimeConnectRequestEvent) error {
		limit, address := realtimePerAddress(), e.RealIP()
		if limit == 0 || privateAddress(address) {
			return e.Next()
		}
		counts := &stateOf(e.App).realtimeAddresses
		if !counts.take(address, limit) {
			return e.TooManyRequestsError("Too many realtime connections from this address.", nil)
		}
		defer counts.release(address)
		return e.Next()
	})
}
