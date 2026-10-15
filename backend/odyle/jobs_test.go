package odyle

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestRemindersPostEachWebhookInTurnAndWebhooksTogether(t *testing.T) {
	app := newTestApp(t)
	var mu sync.Mutex
	now, most, posts := 0, 0, 0
	busy, worst := map[string]int{}, 0
	discord := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		now, posts, busy[r.URL.Path] = now+1, posts+1, busy[r.URL.Path]+1
		most, worst = max(most, now), max(worst, busy[r.URL.Path])
		mu.Unlock()
		time.Sleep(100 * time.Millisecond)
		mu.Lock()
		now, busy[r.URL.Path] = now-1, busy[r.URL.Path]-1
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer discord.Close()
	user := newUser(t, app, "Organizer")
	for i := range 3 {
		room := saved(t, app, "party_rooms", map[string]any{"owner": user.Id, "name": "Room " + strconv.Itoa(i), "cost": 40, "discordWebhook": discord.URL + "/api/webhooks/" + strconv.Itoa(i) + "/token"})
		member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": user.Id, "role": "owner"})
		for range 2 {
			saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(10 * time.Minute)), "plannedBy": member.Id, "attendees": []string{member.Id}})
		}
	}
	out, err := remindRuns(app)
	if err != nil || out["done"] != 6 || out["failed"] != 0 {
		t.Fatalf("%v, %v", out, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if posts != 6 || worst != 1 || most < 2 || most > 4 {
		t.Fatalf("%d posts, up to %d at a time per webhook and %d in all", posts, worst, most)
	}
	// Each run is announced once.
	if again, err := remindRuns(app); err != nil || again["done"] != 0 || posts != 6 {
		t.Fatalf("a second run: %v, %v", again, err)
	}
}
