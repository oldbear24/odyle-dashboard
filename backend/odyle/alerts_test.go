package odyle

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// A job runs once at a time however long it runs (#196): the lock has no expiry and only the run
// that took it lifts it.
func TestALongJobDoesNotRunTwice(t *testing.T) {
	app := newTestApp(t)
	started, release := make(chan struct{}), make(chan struct{})
	runs := 0
	swapJob(t, "odyle-stats", func(core.App) (result, error) {
		runs++
		close(started)
		<-release
		return result{Done: 1}, nil
	})
	done := make(chan result)
	go func() { done <- runJob(app, "odyle-stats", false) }()
	<-started
	// Hours later, as far as the lock goes: it still holds.
	if out := runJob(app, "odyle-stats", true); out.Skipped != "running" {
		t.Fatalf("a second run started: %+v", out)
	}
	close(release)
	if out := <-done; out.Done != 1 {
		t.Fatalf("first run: %+v", out)
	}
	swapJob(t, "odyle-stats", func(core.App) (result, error) { runs++; return result{}, nil })
	if out := runJob(app, "odyle-stats", true); out.Skipped != "" || runs != 2 {
		t.Fatalf("the lock stayed after the run: %+v, %d runs", out, runs)
	}
}

// swapJob replaces a job's work for the test.
func swapJob(t *testing.T, name string, work func(core.App) (result, error)) {
	t.Helper()
	before := jobs[name]
	next := before
	next.work = work
	jobs[name] = next
	t.Cleanup(func() { jobs[name] = before })
}

// A job that ends in an error for half an hour is the operator's to hear of; one that fails some
// of its items, or is paused, is not. A run without an error clears it.
func TestABrokenJobAlertsTheOperator(t *testing.T) {
	app := newTestApp(t)
	swapJob(t, "odyle-stats", func(core.App) (result, error) { return result{}, errors.New("database is locked") })
	swapJob(t, "odyle-expiry", func(core.App) (result, error) { return result{Failed: 3, Error: "one item"}, nil })
	runJob(app, "odyle-stats", false)
	runJob(app, "odyle-expiry", false)
	at := time.Now()
	if problems := operatorProblems(app, at); problems["job:odyle-stats"] != "" {
		t.Fatalf("told at once: %v", problems)
	}
	problems := operatorProblems(app, at.Add(brokenFor+time.Minute))
	if !strings.Contains(problems["job:odyle-stats"], "odyle-stats has ended in an error since") || !strings.Contains(problems["job:odyle-stats"], "database is locked") {
		t.Fatalf("problems %v", problems)
	}
	if _, ok := problems["job:odyle-expiry"]; ok {
		t.Fatalf("failed items alert: %v", problems)
	}
	// A second failing run keeps the time it began.
	since := jobList(app)[5].BrokenSince
	runJob(app, "odyle-stats", false)
	if got := jobList(app)[5]; got.Name != "odyle-stats" || got.BrokenSince != since {
		t.Fatalf("broken since %+v, want %s", got, since)
	}
	swapJob(t, "odyle-stats", func(core.App) (result, error) { return result{Done: 1}, nil })
	runJob(app, "odyle-stats", false)
	if problems := operatorProblems(app, at.Add(brokenFor+time.Minute)); problems["job:odyle-stats"] != "" {
		t.Fatalf("not cleared: %v", problems)
	}
}

// A run that never ends holds its job for good (the lock has no expiry), so the operator hears of
// it once it has gone on for stuckFor; its end clears that.
func TestAStuckJobAlertsTheOperator(t *testing.T) {
	app := newTestApp(t)
	started, release := make(chan struct{}), make(chan struct{})
	swapJob(t, "odyle-stats", func(core.App) (result, error) {
		close(started)
		<-release
		return result{Done: 1}, nil
	})
	done := make(chan result)
	go func() { done <- runJob(app, "odyle-stats", false) }()
	<-started
	at := time.Now()
	if got := operatorProblems(app, at)["job:odyle-stats"]; got != "" {
		t.Fatalf("told at once: %q", got)
	}
	got := operatorProblems(app, at.Add(stuckFor+time.Minute))["job:odyle-stats"]
	if !strings.Contains(got, "odyle-stats has been running since") || !strings.Contains(got, "looks stuck") {
		t.Fatalf("stuck %q", got)
	}
	if out := runJob(app, "odyle-stats", true); out.Skipped != "running" {
		t.Fatalf("a second run started: %+v", out)
	}
	close(release)
	<-done
	if got := operatorProblems(app, at.Add(stuckFor+time.Minute))["job:odyle-stats"]; got != "" {
		t.Fatalf("not cleared: %q", got)
	}
}

// Pausing a broken job clears its alert with words that say so, not as if it worked again; a run
// skipped as paused forgets when the errors began, so once resumed the first failure waits again.
func TestAPausedJobClearsItsAlertAndStartsAfresh(t *testing.T) {
	app := newTestApp(t)
	swapJob(t, "odyle-portraits", func(core.App) (result, error) { return result{}, errors.New("database is locked") })
	runJob(app, "odyle-portraits", false)
	later := time.Now().Add(brokenFor + time.Minute)
	if got := operatorProblems(app, later)["job:odyle-portraits"]; !strings.Contains(got, "has ended in an error since") {
		t.Fatalf("broken %q", got)
	}
	if got := clearedText(app, "job:odyle-portraits"); !strings.Contains(got, "runs without an error again") {
		t.Fatalf("cleared %q", got)
	}
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	if got := operatorProblems(app, later)["job:odyle-portraits"]; got != "" {
		t.Fatalf("paused: %q", got)
	}
	if got := clearedText(app, "job:odyle-portraits"); !strings.Contains(got, "is paused") || strings.Contains(got, "without an error") {
		t.Fatalf("cleared while paused %q", got)
	}
	swapJob(t, "odyle-portraits", func(core.App) (result, error) { return result{Skipped: "paused"}, nil })
	runJob(app, "odyle-portraits", false)
	if got := jobList(app)[1]; got.Name != "odyle-portraits" || got.BrokenSince != "" {
		t.Fatalf("still broken since %+v", got)
	}
	if _, err := writeSettings(app, body{"portraitsPaused": false}); err != nil {
		t.Fatal(err)
	}
	swapJob(t, "odyle-portraits", func(core.App) (result, error) { return result{}, errors.New("database is locked") })
	runJob(app, "odyle-portraits", false)
	if got := operatorProblems(app, time.Now().Add(brokenFor-time.Minute))["job:odyle-portraits"]; got != "" {
		t.Fatalf("told under the old start: %q", got)
	}
}

// Push messages and Discord posts that fail in a row are told once there are streakAlert; one that
// works clears them. A device that turned push off, or a push service that asks to wait, is neither.
func TestOutboundFailuresInARowAlertTheOperator(t *testing.T) {
	app := newTestApp(t)
	o := &stateOf(app).ops
	for range streakAlert - 1 {
		o.notePush(errors.New("dial tcp: i/o timeout"))
	}
	o.notePush(errPushGone)
	o.notePush(pushWaiting("the push service asked to wait 5s more"))
	// A subscription the push service refuses (400, 403, 413) is the subscription's matter.
	o.notePush(pushRefused(http.StatusBadRequest))
	o.notePush(pushRefused(http.StatusForbidden))
	o.notePush(pushRefused(http.StatusRequestEntityTooLarge))
	if problems := operatorProblems(app, time.Now()); problems["push"] != "" {
		t.Fatalf("told early: %v", problems)
	}
	o.notePush(errors.New("dial tcp: i/o timeout"))
	if got := operatorProblems(app, time.Now())["push"]; !strings.Contains(got, "the last 5 push messages could not be delivered (dial tcp: i/o timeout)") {
		t.Fatalf("push %q", got)
	}
	o.notePush(nil)
	if got := operatorProblems(app, time.Now())["push"]; got != "" {
		t.Fatalf("not cleared: %q", got)
	}
	// A push service failing (5xx) counts like the network.
	for range streakAlert {
		o.notePush(pushRefused(http.StatusBadGateway))
	}
	if got := operatorProblems(app, time.Now())["push"]; !strings.Contains(got, "the last 5 push messages could not be delivered (the push service answered 502)") {
		t.Fatalf("push 5xx %q", got)
	}
	o.notePush(nil)

	// Discord: its 5xx answers count, a room's own webhook refused (401, 404) does not.
	owner := newUser(t, app, "Owner")
	room := viewOf[Room](saved(t, app, "party_rooms", map[string]any{"owner": owner.Id, "name": "Raid", "cost": 40}))
	fail := func(string, string, ...any) {}
	for range streakAlert {
		if ok, err := delivered(app, room, "", response{status: http.StatusBadGateway}, fail, "Reminder"); ok || err != nil {
			t.Fatal(ok, err)
		}
	}
	if got := operatorProblems(app, time.Now())["discord"]; !strings.Contains(got, "the last 5 Discord posts and edits for rooms failed (Discord answered 502)") {
		t.Fatalf("discord %q", got)
	}
	if ok, _ := delivered(app, room, "", response{status: http.StatusOK}, fail, "Reminder"); !ok {
		t.Fatal("a post Discord took")
	}
	if got := operatorProblems(app, time.Now())["discord"]; got != "" {
		t.Fatalf("not cleared: %q", got)
	}

	// A VAPID key in the environment that is no key is told at once.
	t.Setenv("ODYLE_VAPID_PRIVATE_KEY", "not a key!")
	if got := operatorProblems(app, time.Now())["push"]; !strings.Contains(got, "ODYLE_VAPID_PRIVATE_KEY is wrong") {
		t.Fatalf("push %q", got)
	}
}

// PLAYNC refusing the armory is told until a lookup works, though its wait ends meanwhile; so are
// many lookups failing in a row. A paused armory is no problem.
func TestArmoryFailuresAlertTheOperatorUntilALookupWorks(t *testing.T) {
	app := newTestApp(t)
	w := stateOf(app).armory
	set := func(change func()) {
		w.mu.Lock()
		change()
		w.mu.Unlock()
	}
	at := time.Now()
	if got := operatorProblems(app, at)["armory"]; got != "" {
		t.Fatalf("armory %q", got)
	}
	// Lookups as the armory's lanes count them.
	fail := func(times int, text string) {
		set(func() {
			w.failed, w.failing, w.lastError = w.failed+times, w.failing+times, text
		})
	}
	worked := func() { set(func() { w.done, w.failing = w.done+1, 0 }) }
	fail(1, "PLAYNC answered 403")
	set(func() { w.blocked = at.Add(10 * time.Minute) })
	if got := operatorProblems(app, at)["armory"]; !strings.Contains(got, "PLAYNC refused the armory's lookups; the queue waits until") {
		t.Fatalf("blocked %q", got)
	}
	if got := operatorProblems(app, at.Add(11*time.Minute))["armory"]; !strings.Contains(got, "none has worked since") {
		t.Fatalf("after the wait %q", got)
	}
	worked()
	if got := operatorProblems(app, at.Add(12*time.Minute))["armory"]; got != "" {
		t.Fatalf("a lookup worked: %q", got)
	}
	// Between two looks: failures, a lookup that worked, and fewer failures than armoryFailing. Only
	// those after the one that worked are in a row.
	fail(armoryFailing-2, "PLAYNC answered 500")
	worked()
	fail(3, "PLAYNC answered 500")
	if got := operatorProblems(app, at.Add(13*time.Minute))["armory"]; got != "" {
		t.Fatalf("failures before a lookup that worked counted: %q", got)
	}
	fail(armoryFailing-3, "PLAYNC answered 500")
	if got := operatorProblems(app, at.Add(13*time.Minute))["armory"]; !strings.Contains(got, "the last 10 armory lookups failed (PLAYNC answered 500)") {
		t.Fatalf("failing %q", got)
	}
	if _, err := writeSettings(app, body{"armoryPaused": true}); err != nil {
		t.Fatal(err)
	}
	if got := operatorProblems(app, at.Add(13*time.Minute))["armory"]; got != "" {
		t.Fatalf("paused: %q", got)
	}
}

// A backup that failed is told until one works; so is a scheduled backup that was not made while
// the server served. Files that could not move into the S3 storage are told too.
func TestBackupAndStorageProblemsAlertTheOperator(t *testing.T) {
	app := newTestApp(t)
	o := &stateOf(app).ops
	at := time.Now()
	o.servedAt.Store(sinceStart(at.Add(-time.Minute)))
	if got := operatorProblems(app, at)["backup"]; got != "" {
		t.Fatalf("a fresh server: %q", got)
	}
	o.noteBackup(errors.New("upload: access denied"))
	if got := operatorProblems(app, at)["backup"]; !strings.Contains(got, "the last backup failed (upload: access denied)") {
		t.Fatalf("failed %q", got)
	}
	o.noteBackup(nil)
	// Served for three days with a nightly schedule (the migration's) and no backup made.
	o.servedAt.Store(sinceStart(at.Add(-72 * time.Hour)))
	if got := operatorProblems(app, at)["backup"]; !strings.Contains(got, "UTC was not made") {
		t.Fatalf("missed %q", got)
	}
	settings, err := app.Settings().Clone()
	if err != nil {
		t.Fatal(err)
	}
	settings.Backups.Cron = ""
	if err := app.Save(settings); err != nil {
		t.Fatal(err)
	}
	if got := operatorProblems(app, at)["backup"]; got != "" {
		t.Fatalf("scheduled backups off: %q", got)
	}

	s := stateOf(app)
	s.mu.Lock()
	s.storageMove = &storageMove{Files: 3, Failed: 2, Error: "bucket refused"}
	s.mu.Unlock()
	if got := operatorProblems(app, at)["storage"]; !strings.Contains(got, "2 files could not be moved into the S3 storage (bucket refused)") {
		t.Fatalf("storage %q", got)
	}
}

func TestLastDue(t *testing.T) {
	before := time.Date(2026, 11, 21, 2, 30, 0, 0, time.UTC)
	for schedule, want := range map[string]time.Time{
		"0 3 * * *": time.Date(2026, 11, 20, 3, 0, 0, 0, time.UTC),
		"0 3 * * 0": time.Date(2026, 11, 15, 3, 0, 0, 0, time.UTC),
		"0 3 1 * *": {},
		"":          {},
		"nonsense":  {},
	} {
		if got := lastDue(schedule, before); !got.Equal(want) {
			t.Errorf("%q: %v, want %v", schedule, got, want)
		}
	}
}

// The server's problems reach the operator once each, and once more when they clear, with
// Server status listing them.
func TestServerProblemsAreToldOnceAndCleared(t *testing.T) {
	app := newTestApp(t)
	var mu sync.Mutex
	var posted []string
	discord := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var message map[string]any
		_ = json.NewDecoder(r.Body).Decode(&message)
		mu.Lock()
		posted = append(posted, message["content"].(string))
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer discord.Close()
	t.Setenv("ODYLE_DISCORD_WEBHOOK_BASE", discord.URL)
	t.Setenv("ODYLE_ALERT_WEBHOOK", discord.URL+"/api/webhooks/12345/abcdefghijklmnopqrstuvwx")
	o := &stateOf(app).ops
	for range streakAlert {
		o.notePush(errors.New("push service down"))
	}
	for range 3 {
		if out, err := checkHealth(app); err != nil || out.Failed != 0 {
			t.Fatal(out, err)
		}
	}
	summary, _ := readerHealth(app, time.Now())
	if got := asJSON(t, summary); !strings.Contains(got, `"serverProblems":[{"key":"push","message":"the last 5 push messages`) {
		t.Fatalf("summary %s", got)
	}
	o.notePush(nil)
	if _, err := checkHealth(app); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(posted) != 2 || !strings.HasPrefix(posted[0], "Odyle alert: the last 5 push messages") || posted[1] != "Odyle: cleared, push messages are delivered again." {
		t.Fatalf("posted %q", posted)
	}
}

// GET /api/health answers 503 with what is wrong when a restart could mend it: a data folder that
// takes no file, or a cron that stopped. Without either it answers PocketBase's 200.
func TestHealthCheckFailsOnlyForWhatARestartMends(t *testing.T) {
	app := newTestApp(t)
	health := func(status int, want string) {
		t.Helper()
		(&tests.ApiScenario{Name: "GET /api/health", Method: http.MethodGet, URL: "/api/health", ExpectedStatus: status, ExpectedContent: []string{want},
			TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true}).Test(t)
	}
	health(200, `"code":200`)
	// Problems a restart does not mend leave it healthy.
	o := &stateOf(app).ops
	for range streakAlert {
		o.notePush(errors.New("push service down"))
		o.discord.note(errors.New("Discord answered 503"))
	}
	o.noteBackup(errors.New("upload failed"))
	health(200, `"code":200`)

	// The cron, outside tests: silent for longer than cronSilent.
	s := stateOf(app)
	s.byHand.Store(false)
	t.Cleanup(func() { s.byHand.Store(true) })
	at := time.Now()
	o.cronAt.Store(sinceStart(at.Add(-time.Minute)))
	o.checkMu.Lock()
	o.checkedAt = time.Time{}
	o.checkMu.Unlock()
	if problem := serverHealth(app, at); problem != "" {
		t.Fatalf("a ticking cron: %q", problem)
	}
	o.cronAt.Store(sinceStart(at.Add(-cronSilent - time.Minute)))
	if problem := serverHealth(app, at.Add(time.Second)); problem != "" {
		t.Fatalf("the look is reused for healthCheckAge: %q", problem)
	}
	problem := serverHealth(app, at.Add(healthCheckAge+time.Second))
	if !strings.Contains(problem, "The scheduled jobs have not run for 11 minutes.") {
		t.Fatalf("a silent cron: %q", problem)
	}
	// A job the cron starts counts as a tick.
	for _, j := range app.Cron().Jobs() {
		if j.Id() == "odyle-health" {
			j.Run()
		}
	}
	o.checkMu.Lock()
	o.checkedAt = time.Time{}
	o.checkMu.Unlock()
	if ticked := serverHealth(app, time.Now()); ticked != "" {
		t.Fatalf("after a tick: %q", ticked)
	}
	if ago := time.Duration(sinceStart(time.Now()) - o.cronAt.Load()); ago < 0 || ago > time.Minute {
		t.Fatalf("the tick is noted %v ago", ago)
	}
	// The route answers with the look (tests serve with byHand on, which skips the cron).
	s.byHand.Store(true)
	o.checkMu.Lock()
	o.checkedAt, o.checkProblem = time.Now(), problem
	o.checkMu.Unlock()
	health(503, "The scheduled jobs have not run")

	if err := writeTest(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("a folder that takes no file passed")
	}
	if err := writeTest(t.TempDir()); err != nil {
		t.Fatal(err)
	}
}
