package odyle

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// releaseFeed stands in for GitHub's latest release API: it answers after delay, with an
// ETag, and 304 to a request that names it.
type releaseFeed struct {
	hits, notModified atomic.Int32
	delay             atomic.Int64                     // nanoseconds
	answer            func(w http.ResponseWriter) bool // answers instead, when it returns true
}

func (f *releaseFeed) serve(t *testing.T) *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.hits.Add(1)
		time.Sleep(time.Duration(f.delay.Load()))
		if f.answer != nil && f.answer(w) {
			return
		}
		if r.Header.Get("If-None-Match") == `W/"v0.6.1.4"` {
			f.notModified.Add(1)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `W/"v0.6.1.4"`)
		w.Write([]byte(`{"tag_name":"v0.6.1.4","html_url":"https://github.com/oldbear24/odyle-windows/releases/tag/v0.6.1.4","published_at":"2026-10-15T10:00:00Z","draft":false,"prerelease":false,"assets":[]}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("ODYLE_WINDOWS_RELEASE_URL", server.URL+"/releases/latest")
	return server
}

func version(release map[string]any) string { v, _ := release["version"].(string); return v }

func TestReleaseLookupIsSharedAndNeverMakesRequestsWait(t *testing.T) {
	feed := &releaseFeed{}
	feed.delay.Store(int64(100 * time.Millisecond))
	feed.serve(t)
	app := newTestApp(t)
	// The first requests find no release: they wait for one lookup together.
	var wg sync.WaitGroup
	versions := make([]string, 10)
	for i := range versions {
		wg.Go(func() { versions[i] = version(latestRelease(app)) })
	}
	wg.Wait()
	if feed.hits.Load() != 1 || strings.Join(versions, ",") != strings.Repeat("0.6.1.4,", 9)+"0.6.1.4" {
		t.Fatalf("%d lookups for %v", feed.hits.Load(), versions)
	}
	// Ten minutes later the known release is answered at once while GitHub is asked
	// again, whether it changed.
	s := stateOf(app)
	s.mu.Lock()
	s.releaseAt = s.releaseAt.Add(-11 * time.Minute)
	s.mu.Unlock()
	feed.delay.Store(int64(300 * time.Millisecond))
	started := time.Now()
	if got := version(latestRelease(app)); got != "0.6.1.4" || time.Since(started) > 150*time.Millisecond {
		t.Fatalf("a stale cache answered %q after %v", got, time.Since(started))
	}
	waitFor(t, func() bool { s.mu.Lock(); defer s.mu.Unlock(); return s.releaseInFlight == nil })
	if feed.hits.Load() != 2 || feed.notModified.Load() != 1 {
		t.Fatalf("%d lookups, %d unchanged", feed.hits.Load(), feed.notModified.Load())
	}
	lookup := releaseLookup(app)
	if at, _ := lookup.get("fetchedAt"); at != lookup.values["checkedAt"] || version(latestRelease(app)) != "0.6.1.4" {
		t.Fatalf("an unchanged answer: %v", lookup.values)
	}
}

func TestReleaseLookupWaitsForGitHubsRateLimit(t *testing.T) {
	feed := &releaseFeed{}
	reset := time.Now().Add(time.Hour).Unix()
	feed.answer = func(w http.ResponseWriter) bool {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset, 10))
		w.WriteHeader(http.StatusForbidden)
		return true
	}
	feed.serve(t)
	app := newTestApp(t)
	if latestRelease(app) != nil {
		t.Fatal("a rate limited lookup found a release")
	}
	if text, _ := releaseLookup(app).get("error"); !strings.Contains(text.(string), "GitHub answered 403: rate limited until ") {
		t.Fatalf("the Server status page reads %q", text)
	}
	s := stateOf(app)
	s.mu.Lock()
	s.releaseAt = s.releaseAt.Add(-5 * time.Minute)
	s.mu.Unlock()
	latestRelease(app)
	if feed.hits.Load() != 1 {
		t.Fatalf("asked GitHub %d times during its rate limit", feed.hits.Load())
	}
}

// waitFor waits up to two seconds for the condition.
func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	for range 200 {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out")
}

func TestReleaseNotesGiveTheChangesBetweenTheirMarkers(t *testing.T) {
	notes := "Intro\r\n<!-- changes -->\r\n### New\r\n- **Compact mode** shows your party.\r\n- Second\r\n\r\n### Fixed\r\n- Updates work again.\r\n<!-- /changes -->\r\n## What's Changed\r\n- not this\r\n"
	got := releaseChanges(notes)
	if len(got) != 2 || got[0]["title"] != "New" || len(got[0]["items"].([]string)) != 2 || got[0]["items"].([]string)[0] != "**Compact mode** shows your party." || got[1]["items"].([]string)[0] != "Updates work again." {
		t.Fatalf("changes %v", got)
	}
	if got := releaseChanges("## What's Changed\n- a PR"); len(got) != 0 {
		t.Fatalf("notes without markers: %v", got)
	}
}

// Update all apps now (Apps & packets): every signed-in client hears windowsUpdate on its own
// account's topic with the release the backend knows, the answer counts them, and only
// superusers may ask.
func TestSuperusersAskEveryRunningAppToUpdate(t *testing.T) {
	app := newTestApp(t)
	lead, other := newUser(t, app, "Lead"), newUser(t, app, "Other")
	operator, err := newRecord(app, core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	operator.SetEmail("operator@test.invalid")
	operator.SetPassword("password-for-tests-only")
	if err := app.Save(operator); err != nil {
		t.Fatal(err)
	}
	const url = "/api/odyle/admin/update-apps"
	ask(t, app, http.MethodPost, url, nil, "", 401)
	ask(t, app, http.MethodPost, url, tokenOf(t, lead), "", 403)

	mine, theirs := listen(t, app, lead, userTopic+lead.Id), listen(t, app, other, userTopic+other.Id)
	// A connection without its account's topic is not told.
	quiet := listen(t, app, other)
	update := func(l *listener) map[string]any {
		t.Helper()
		topic, data, ok := l.next()
		u, _ := data["windowsUpdate"].(map[string]any)
		if !ok || u == nil || !strings.HasPrefix(topic, userTopic) {
			t.Fatalf("no update: %s %v", topic, data)
		}
		if at, err := time.Parse(time.RFC3339, u["at"].(string)); err != nil || time.Since(at) > time.Minute {
			t.Fatalf("at %v %v", u["at"], err)
		}
		return u
	}

	// No release known: the version is left out and the apps ask GitHub themselves.
	out := ask(t, app, http.MethodPost, url, tokenOf(t, operator), "", 200)
	if out["told"] != float64(2) || out["version"] != "" {
		t.Fatalf("answer %v", out)
	}
	for _, l := range []*listener{mine, theirs} {
		if u := update(l); u["version"] != nil {
			t.Fatalf("a version without a release: %v", u)
		}
	}
	quiet.quiet()

	s := stateOf(app)
	s.mu.Lock()
	s.release, s.releaseChecked, s.releaseAt = map[string]any{"version": "0.30.0"}, true, time.Now()
	s.mu.Unlock()
	out = ask(t, app, http.MethodPost, url, tokenOf(t, operator), "", 200)
	if out["told"] != float64(2) || out["version"] != "0.30.0" {
		t.Fatalf("answer %v", out)
	}
	for _, l := range []*listener{mine, theirs} {
		if u := update(l); u["version"] != "0.30.0" {
			t.Fatalf("version %v", u)
		}
	}
	quiet.quiet()
}
