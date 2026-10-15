package odyle

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// plaync stands in for PLAYNC's character search and portrait host: every character is
// listed on Lumiel (EU, server 2304) with a one-pixel PNG, answered after delay. It
// counts its requests and the most it answered at the same time.
type plaync struct {
	requests, now, most atomic.Int32
	delay               time.Duration
}

func (p *plaync) serve(t *testing.T) {
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.requests.Add(1)
		at := p.now.Add(1)
		defer p.now.Add(-1)
		for most := p.most.Load(); at > most && !p.most.CompareAndSwap(most, at); most = p.most.Load() {
		}
		time.Sleep(p.delay)
		if r.URL.Path == "/search" {
			name := r.URL.Query().Get("keyword")
			json.NewEncoder(w).Encode(map[string]any{"list": []any{map[string]any{"name": name, "serverId": 2304, "profileImageUrl": "/images?name=" + name}}})
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write(png)
	}))
	t.Cleanup(server.Close)
	t.Setenv("PLAYNC_SEARCH_URL", server.URL+"/search")
	t.Setenv("PLAYNC_IMAGE_URL", server.URL)
}

func newGameCharacter(t *testing.T, app core.App, user, name string) string {
	t.Helper()
	return saved(t, app, "characters", map[string]any{"user": user, "characterName": name, "server": "Lumiel", "region": "GLOBAL_EU"}).Id
}

func portraitOf(t *testing.T, app core.App, id string) string {
	t.Helper()
	c, err := app.FindRecordById("characters", id)
	if err != nil {
		t.Fatal(err)
	}
	return c.GetString("portrait")
}

func TestNewCharactersGetTheirPortraitAtOnceTwoLookupsAtATime(t *testing.T) {
	stand := &plaync{delay: 20 * time.Millisecond}
	stand.serve(t)
	app := newTestApp(t)
	user := newUser(t, app, "Painter")
	ids := []string{}
	for _, name := range []string{"Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"} {
		ids = append(ids, newGameCharacter(t, app, user.Id, name))
	}
	stateOf(app).portraits.wait()
	for _, id := range ids {
		if portraitOf(t, app, id) == "" {
			t.Errorf("character %s has no portrait", id)
		}
	}
	// A search and a download per character, never more than two at a time.
	if stand.requests.Load() != 12 || stand.most.Load() > 2 {
		t.Fatalf("%d requests, at most %d at a time", stand.requests.Load(), stand.most.Load())
	}
	// The job finds nothing left to do.
	out, err := refreshPortraits(app)
	if err != nil || out.Done != 0 || stand.requests.Load() != 12 {
		t.Fatalf("job after the lookups: %v, %v, %d requests", out, err, stand.requests.Load())
	}
}

func TestPausedPortraitsWaitForTheJob(t *testing.T) {
	stand := &plaync{}
	stand.serve(t)
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	user := newUser(t, app, "Patient")
	id := newGameCharacter(t, app, user.Id, "Waiting")
	stateOf(app).portraits.wait()
	if stand.requests.Load() != 0 || portraitOf(t, app, id) != "" {
		t.Fatalf("paused portraits looked up: %d requests", stand.requests.Load())
	}
	if _, err := writeSettings(app, body{"portraitsPaused": false}); err != nil {
		t.Fatal(err)
	}
	// A lookup already running is left to it.
	work := stateOf(app).portraits
	if !work.claim(id) {
		t.Fatal("nothing should run for the character")
	}
	if out, err := refreshPortraits(app); err != nil || out.Done != 0 || stand.requests.Load() != 0 {
		t.Fatalf("the job took a running lookup: %v, %v", out, err)
	}
	if err := work.lookUp(app, id); err != nil {
		t.Fatal(err)
	}
	if portraitOf(t, app, id) == "" {
		t.Fatal("no portrait after the lookup")
	}
}

func TestPortraitKeepsAReadingSavedDuringTheLookup(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Reader")
	var id string
	// The reading lands while PLAYNC answers the search.
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/search" {
			c, _ := app.FindRecordById("characters", id)
			c.Set("value", 390)
			c.Set("confirmed", true)
			app.Save(c)
			json.NewEncoder(w).Encode(map[string]any{"list": []any{map[string]any{"name": "Reader", "serverId": 2304, "profileImageUrl": "/images"}}})
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write(png)
	}))
	defer server.Close()
	t.Setenv("PLAYNC_SEARCH_URL", server.URL+"/search")
	t.Setenv("PLAYNC_IMAGE_URL", server.URL)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	id = newGameCharacter(t, app, user.Id, "Reader")
	if err := gamePortrait(app, id); err != nil {
		t.Fatal(err)
	}
	c, _ := app.FindRecordById("characters", id)
	if c.GetInt("value") != 390 || !c.GetBool("confirmed") || c.GetString("portrait") == "" {
		t.Fatalf("value %d, confirmed %v, portrait %q", c.GetInt("value"), c.GetBool("confirmed"), c.GetString("portrait"))
	}
}
