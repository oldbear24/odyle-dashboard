package odyle

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// plaync stands in for PLAYNC's character search and portrait host: every character is
// listed on Lumiel (EU, server 2304) with a one-pixel PNG, answered after delay (and
// once gate is closed, when there is one). search, when set, answers the searches
// instead. It counts its requests and the most it answered at the same time.
type plaync struct {
	requests, now, most atomic.Int32
	searches            atomic.Int32
	delay               time.Duration
	gate                chan struct{}
	search              func(query url.Values) (int, any)
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
		if p.gate != nil {
			<-p.gate
		}
		if r.URL.Path == "/search" {
			p.searches.Add(1)
			if p.search != nil {
				status, answer := p.search(r.URL.Query())
				w.WriteHeader(status)
				json.NewEncoder(w).Encode(answer)
				return
			}
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

// characterOn saves a character of a server and region with portraits paused, so only
// the test looks it up.
func characterOn(t *testing.T, app core.App, name, server, region string) string {
	t.Helper()
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	user := newUser(t, app, "Owner"+name)
	return saved(t, app, "characters", map[string]any{"user": user.Id, "characterName": name, "server": server, "region": region}).Id
}

func portraitMisses(t *testing.T, app core.App, id string) int {
	t.Helper()
	c, err := findAs[Character](app, "characters", id)
	if err != nil {
		t.Fatal(err)
	}
	return c.PortraitMisses()
}

func TestPortraitSearchReadsFurtherPagesForShortNames(t *testing.T) {
	// Lumiel lists 25 names containing "Al", 20 to a page; Al itself is on page 2. Any
	// other keyword matches 1,000 names, none of them exactly.
	stand := &plaync{search: func(q url.Values) (int, any) {
		page, _ := strconv.Atoi(q.Get("page"))
		if q.Get("size") != "20" || page < 1 {
			return 400, map[string]any{}
		}
		total, list := 1000, []any{}
		if q.Get("keyword") == "Al" {
			total = 25
		}
		for i := (page - 1) * 20; i < min(page*20, total); i++ {
			list = append(list, map[string]any{"name": q.Get("keyword") + "x" + strconv.Itoa(i), "serverId": 2304, "profileImageUrl": "/images?other"})
		}
		if q.Get("keyword") == "Al" && page == 2 {
			list[3] = map[string]any{"name": "<strong>Al</strong>", "serverId": 2304, "profileImageUrl": "/images?al"}
		}
		return 200, map[string]any{"list": list, "pagination": map[string]any{"page": page, "size": 20, "total": total}}
	}}
	stand.serve(t)
	app := newTestApp(t)
	al := characterOn(t, app, "Al", "Lumiel", "GLOBAL_EU")
	if err := gamePortrait(app, al); err != nil || portraitOf(t, app, al) == "" {
		t.Fatalf("no portrait from page 2: %v", err)
	}
	if stand.searches.Load() != 2 || stand.requests.Load() != 3 || portraitMisses(t, app, al) != 0 {
		t.Fatalf("%d searches, %d requests, %d misses", stand.searches.Load(), stand.requests.Load(), portraitMisses(t, app, al))
	}
	// A name on none of the pages: five pages at most, and each lookup counts a miss.
	nobody := characterOn(t, app, "Nobody", "Lumiel", "GLOBAL_EU")
	for want := 1; want <= 2; want++ {
		if err := gamePortrait(app, nobody); err != nil || portraitOf(t, app, nobody) != "" || portraitMisses(t, app, nobody) != want {
			t.Fatalf("lookup %d: %v, %d misses", want, err, portraitMisses(t, app, nobody))
		}
	}
	if stand.searches.Load() != 2+2*searchPages {
		t.Fatalf("%d searches", stand.searches.Load())
	}
}

func TestNorthAmericaWestIsSearchedWhenEastFails(t *testing.T) {
	// Nezekan is server 1102 on NA East and 1202 on NA West; East is down.
	stand := &plaync{search: func(q url.Values) (int, any) {
		if q.Get("region") == "nae" {
			return 503, map[string]any{}
		}
		list := []any{}
		if q.Get("keyword") == "Western" && q.Get("serverId") == "1202" {
			list = append(list, map[string]any{"name": "Western", "serverId": 1202, "profileImageUrl": "/images?west"})
		}
		return 200, map[string]any{"list": list}
	}}
	stand.serve(t)
	app := newTestApp(t)
	west := characterOn(t, app, "Western", "Nezekan", "GLOBAL_NA")
	if err := gamePortrait(app, west); err != nil || portraitOf(t, app, west) == "" || portraitMisses(t, app, west) != 0 {
		t.Fatalf("West was not searched: %v", err)
	}
	// Not on West, and East could not answer: the lookup failed, which is no miss.
	east := characterOn(t, app, "Eastern", "Nezekan", "GLOBAL_NA")
	err := gamePortrait(app, east)
	if err == nil || err.Error() != "The official character search is unavailable (503)." || portraitMisses(t, app, east) != 0 {
		t.Fatalf("East's failure: %v, %d misses", err, portraitMisses(t, app, east))
	}
	if c, _ := findAs[Character](app, "characters", east); c.GetString("portraitCheckedAt") == "" {
		t.Fatal("the failed lookup was not noted")
	}
}

func TestMissingPortraitsBackOffAndDormantCharactersWait(t *testing.T) {
	app := newTestApp(t)
	id := characterOn(t, app, "Patient", "Lumiel", "GLOBAL_EU")
	at := func(d time.Duration) string {
		if d == 0 {
			return ""
		}
		return ago(d)
	}
	// set ages the character: its last lookup, misses, picture, last sighting and save.
	set := func(checked time.Duration, misses int, portrait string, seen, saved time.Duration) {
		t.Helper()
		_, err := app.DB().NewQuery("UPDATE characters SET portraitCheckedAt = {:checked}, portraitMisses = {:misses}, portrait = {:portrait}, lastSeenAt = {:seen}, created = {:created} WHERE id = {:id}").
			Bind(dbx.Params{"checked": at(checked), "misses": misses, "portrait": portrait, "seen": at(seen), "created": ago(saved), "id": id}).Execute()
		if err != nil {
			t.Fatal(err)
		}
	}
	due := func() bool {
		t.Helper()
		found, err := duePortraits(app, 100)
		if err != nil {
			t.Fatal(err)
		}
		return slices.ContainsFunc(found, func(r *core.Record) bool { return r.Id == id })
	}
	hour, day := time.Hour, 24*time.Hour
	for _, c := range []struct {
		name     string
		checked  time.Duration
		misses   int
		portrait string
		seen     time.Duration
		saved    time.Duration
		due      bool
	}{
		{"never looked up", 0, 0, "", hour, day, true},
		{"one miss, 30 minutes ago", hour / 2, 1, "", hour, day, false},
		{"one miss, two hours ago", 2 * hour, 1, "", hour, day, true},
		{"a failed first lookup, two hours ago", 2 * hour, 0, "", hour, day, true},
		{"two misses, two hours ago", 2 * hour, 2, "", hour, day, false},
		{"two misses, seven hours ago", 7 * hour, 2, "", hour, day, true},
		{"three misses, seven hours ago", 7 * hour, 3, "", hour, day, false},
		{"three misses, a day ago", 25 * hour, 3, "", hour, 2 * day, true},
		{"four misses, a day ago", 25 * hour, 4, "", hour, 2 * day, false},
		{"four misses, eight days ago", 8 * day, 4, "", hour, 9 * day, true},
		{"a portrait, two hours ago", 2 * hour, 0, "portrait.png", hour, day, false},
		{"a portrait, a day ago", 25 * hour, 0, "portrait.png", hour, 2 * day, true},
		{"not seen for 61 days", 0, 0, "", 61 * day, 90 * day, false},
		{"seen yesterday after months", 0, 0, "", day, 90 * day, true},
		{"saved 61 days ago and never read", 8 * day, 4, "", 0, 61 * day, false},
		{"saved a week ago and never read", 0, 0, "", 0, 7 * day, true},
	} {
		set(c.checked, c.misses, c.portrait, c.seen, c.saved)
		if due() != c.due {
			t.Errorf("%s: due %v", c.name, !c.due)
		}
	}
}

func TestUpToTenNewCharactersWaitForTheirPortrait(t *testing.T) {
	// PLAYNC answers nothing until the gate opens, so no lookup ends while characters are saved.
	stand := &plaync{gate: make(chan struct{})}
	stand.serve(t)
	app := newTestApp(t)
	user := newUser(t, app, "Crowd")
	ids := []string{}
	for i := range 14 {
		ids = append(ids, newGameCharacter(t, app, user.Id, "Crowd"+strconv.Itoa(i)))
	}
	work := stateOf(app).portraits
	work.mu.Lock()
	queued, running := work.queued, len(work.running)
	work.mu.Unlock()
	if queued != queuedPortraits || running != queuedPortraits {
		t.Fatalf("%d queued, %d running", queued, running)
	}
	close(stand.gate)
	work.wait()
	pictured := func() int {
		n := 0
		for _, id := range ids {
			if portraitOf(t, app, id) != "" {
				n++
			}
		}
		return n
	}
	if pictured() != queuedPortraits || stand.requests.Load() != 2*queuedPortraits {
		t.Fatalf("%d portraits after %d requests", pictured(), stand.requests.Load())
	}
	// The job looks up the characters left to it.
	if out, err := refreshPortraits(app); err != nil || out.Done != 4 || pictured() != 14 {
		t.Fatalf("job: %v, %v, %d portraits", out, err, pictured())
	}
}
