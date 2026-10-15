package odyle

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSendCapsTheAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(strings.Repeat("x", 2000)))
	}))
	defer server.Close()
	if _, err := send(call{method: "GET", url: server.URL, timeout: time.Second, limit: 1999}); err == nil || !strings.Contains(err.Error(), "larger than 1999 bytes") {
		t.Fatalf("an answer over the limit: %v", err)
	}
	res, err := send(call{method: "GET", url: server.URL, timeout: time.Second, limit: 2000})
	if err != nil || len(res.body) != 2000 {
		t.Fatalf("an answer at the limit: %d bytes, %v", len(res.body), err)
	}
}

func TestSendFollowsOnlyAllowedRedirects(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("image")) }))
	defer target.Close()
	// The target by another name, so the hosts differ: localhost instead of 127.0.0.1.
	moved := strings.Replace(target.URL, "127.0.0.1", "localhost", 1)
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, moved+"/file", http.StatusFound) }))
	defer origin.Close()
	refused, err := send(call{method: "GET", url: origin.URL, timeout: time.Second, limit: 100})
	if err != nil || refused.status != http.StatusFound {
		t.Fatalf("without allowed hosts the redirect is the answer: %d, %v", refused.status, err)
	}
	if other, err := send(call{method: "GET", url: origin.URL, timeout: time.Second, limit: 100, redirects: []string{"*.localhost", "127.0.0.1"}}); err != nil || other.status != http.StatusFound {
		t.Fatalf("a host not listed: %d, %v", other.status, err)
	}
	followed, err := send(call{method: "GET", url: origin.URL, timeout: time.Second, limit: 100, redirects: []string{"localhost"}})
	if err != nil || followed.status != http.StatusOK || string(followed.body) != "image" {
		t.Fatalf("an allowed redirect: %d %q, %v", followed.status, followed.body, err)
	}
}

func TestAllowedRedirectHosts(t *testing.T) {
	first, _ := url.Parse("https://profileimg.plaync.com/game_profile_images/aion2global/images?charKey=1")
	hosts := []string{"*.plaync.com", "*.playnccdn.com", "api.github.com"}
	for link, want := range map[string]bool{
		"https://fizz-download.playnccdn.com/download/v2/file": true,
		"https://FIZZ-download.PlayncCDN.com/file":             true,
		"https://api.github.com/repositories/1/releases":       true,
		"https://playnccdn.com/file":                           false,
		"https://playnccdn.com.example.com/file":               false,
		"https://evilplaynccdn.com/file":                       false,
		"https://uploads.github.com/file":                      false,
		"http://fizz-download.playnccdn.com/file":              false,
		"ftp://fizz-download.playnccdn.com/file":               false,
	} {
		target, _ := url.Parse(link)
		if got := allowedRedirect(target, first, hosts); got != want {
			t.Errorf("%s: %v", link, got)
		}
	}
}

func TestSendErrorsNameTheHostOnly(t *testing.T) {
	closed := httptest.NewServer(http.NotFoundHandler())
	link := closed.URL
	closed.Close()
	_, err := send(call{method: "POST", url: link + "/api/webhooks/123456/secret-token?wait=true", timeout: time.Second, limit: 100})
	if err == nil || strings.Contains(err.Error(), "secret-token") || !strings.HasPrefix(err.Error(), "POST "+strings.TrimPrefix(link, "http://")+": ") {
		t.Fatalf("a refused connection: %v", err)
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(300 * time.Millisecond) }))
	defer slow.Close()
	if _, err := send(call{method: "GET", url: slow.URL + "/?keyword=Secret", timeout: 50 * time.Millisecond, limit: 100}); err == nil || !strings.HasSuffix(err.Error(), ": no answer in time") || strings.Contains(err.Error(), "Secret") {
		t.Fatalf("a slow answer: %v", err)
	}
}

func TestRetryAfter(t *testing.T) {
	header := func(v string) response { return response{header: http.Header{"Retry-After": {v}}} }
	if got := retryAfter(header("1.5")); got != 1500*time.Millisecond {
		t.Errorf("seconds: %v", got)
	}
	if got := retryAfter(header(time.Now().Add(time.Minute).UTC().Format(http.TimeFormat))); got < 58*time.Second || got > time.Minute {
		t.Errorf("a date: %v", got)
	}
	if got := retryAfter(response{header: http.Header{}, body: []byte(`{"message":"You are being rate limited.","retry_after":0.25,"global":false}`)}); got != 250*time.Millisecond {
		t.Errorf("Discord's body: %v", got)
	}
	if got := retryAfter(response{header: http.Header{}}); got != 0 {
		t.Errorf("nothing: %v", got)
	}
}

func TestRemindersWaitWhenDiscordAsks(t *testing.T) {
	app := newTestApp(t)
	var posts atomic.Int32
	answers := make(chan func(http.ResponseWriter), 10)
	discord := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posts.Add(1)
		select {
		case answer := <-answers:
			answer(w)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer discord.Close()
	limited := func(retry string, global bool) func(http.ResponseWriter) {
		return func(w http.ResponseWriter) {
			w.Header().Set("Retry-After", retry)
			if global {
				w.Header().Set("X-RateLimit-Global", "true")
			}
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"message":"You are being rate limited.","retry_after":` + retry + `}`))
		}
	}
	user := newUser(t, app, "Planner")
	room := saved(t, app, "party_rooms", map[string]any{"owner": user.Id, "name": "Raid", "cost": 40, "discordWebhook": discord.URL + "/api/webhooks/1/token"})
	member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": user.Id, "role": "owner"})
	plan := func() {
		saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "startsAt": stamp(time.Now().Add(10 * time.Minute)), "plannedBy": member.Id, "attendees": []string{member.Id}})
	}
	plan()
	// A short wait is waited out once.
	answers <- limited("0.05", false)
	out, err := remindRuns(app)
	if err != nil || out.Done != 1 || out.Failed != 0 || posts.Load() != 2 {
		t.Fatalf("short wait: %v, %v, %d posts", out, err, posts.Load())
	}
	// A long one leaves the webhook alone until then, without posting again.
	plan()
	answers <- limited("30", false)
	out, err = remindRuns(app)
	if err != nil || out.Done != 0 || out.Failed != 1 || !strings.Contains(out.Error, "waits") || posts.Load() != 3 {
		t.Fatalf("long wait: %v, %v, %d posts", out, err, posts.Load())
	}
	out, err = remindRuns(app)
	if err != nil || out.Done != 0 || out.Failed != 0 || posts.Load() != 3 {
		t.Fatalf("while waiting: %v, %v, %d posts", out, err, posts.Load())
	}
	// Once the wait is over the run is posted.
	stateOf(app).webhooks.until = nil
	out, err = remindRuns(app)
	if err != nil || out.Done != 1 || posts.Load() != 4 {
		t.Fatalf("after the wait: %v, %v, %d posts", out, err, posts.Load())
	}
	// A global limit holds every webhook.
	waits := &stateOf(app).webhooks
	waits.wait(discord.URL+"/api/webhooks/1/token", response{header: http.Header{"Retry-After": {"30"}, "X-Ratelimit-Global": {"true"}}}, time.Now())
	if !waits.waiting("https://discord.com/api/webhooks/2/other", time.Now()) {
		t.Fatal("a global limit holds other webhooks")
	}
}
