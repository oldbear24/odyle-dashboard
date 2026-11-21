package odyle

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/cron"
)

// Operator alerts beyond the readers (#196), and the health check.
//
// The odyle-health job (health.go) tells the operator of each problem once when it starts and
// once when it clears. Besides the readers and the clock it watches:
//   - backup: the last backup failed, or a scheduled one was not made;
//   - job:<name>: a background job has ended in an error for brokenFor;
//   - storage: files could not be moved into the S3 storage;
//   - armory: PLAYNC refused the armory's lookups, or many failed in a row, since one worked;
//   - push: ODYLE_VAPID_PRIVATE_KEY is not a key, or push messages failed streakAlert times in a row;
//   - discord: the rooms' Discord posts and edits failed streakAlert times in a row.
//
// Each stays a problem until what caused it is over (a backup, a lookup, a push or a post that
// works), so a problem that comes and goes with every try is told once.
//
// GET /api/health, the image's health check (backend/healthcheck.go), answers 503 only for what a
// restart can mend: a data folder the server cannot write to, or a cron that stopped ticking. The
// problems above, which a restart does not mend, leave it healthy.

const (
	// streakAlert is how many push messages or Discord posts in a row fail before the operator hears.
	streakAlert = 5
	// brokenFor is how long a job ends in an error before the operator hears: a job that runs every
	// minute has failed some 30 times, a daily one once and not since.
	brokenFor = 30 * time.Minute
	// armoryFailing is how many armory lookups in a row fail before the operator hears.
	armoryFailing = 10
	// backupGrace is how long a scheduled backup may take before it counts as not made.
	backupGrace = time.Hour
	// cronSilent is how long the cron may go without starting a job before the health check fails;
	// several jobs run every minute.
	cronSilent = 10 * time.Minute
	// healthCheckAge is how long a health check's write test is reused: the route is public.
	healthCheckAge = 30 * time.Second
	// pushesDrain is how long a stopping server waits for push messages on their way.
	pushesDrain = 5 * time.Second
)

// processStart is the reference of the monotonic times opsState keeps.
var processStart = time.Now()

func sinceStart(at time.Time) int64 { return int64(at.Sub(processStart)) }

// opsState is what the operator alerts and the health check watch, in server memory only.
type opsState struct {
	cronAt   atomic.Int64 // when the cron last started a job (sinceStart), 0 before
	servedAt atomic.Int64 // when the server began to serve (sinceStart), 0 before

	push, discord streak

	mu             sync.Mutex
	backupFailure  string // why the last backup failed; empty since one that worked
	armoryDone     int    // the armory's counters at the last look
	armoryFailed   int
	armoryFailures int  // lookups failed since the last one that worked, as far as the looks tell
	armoryRefused  bool // PLAYNC refused the server since the last lookup that worked

	checkMu      sync.Mutex
	checkedAt    time.Time // the health check's last look
	checkProblem string    // what it found, empty when healthy
}

// streak counts the outbound requests of one kind that failed in a row, with the last error.
type streak struct {
	mu       sync.Mutex
	failures int
	last     string
}

func (s *streak) note(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err == nil {
		s.failures, s.last = 0, ""
		return
	}
	s.failures++
	s.last = message(err)
}

func (s *streak) read() (int, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.failures, s.last
}

// pushWaiting is a push service's 429: it asked to be left alone for a while, which is no failure.
type pushWaiting string

func (w pushWaiting) Error() string { return string(w) }

// notePush counts a push message's outcome: one its push service forgot (the device turned push
// off) or asked to wait for is neither a success nor a failure of the server's.
func (o *opsState) notePush(err error) {
	var waiting pushWaiting
	if errors.Is(err, errPushGone) || errors.As(err, &waiting) {
		return
	}
	o.push.note(err)
}

// noteBackup keeps how the last backup went (OnBackupCreate, register.go).
func (o *opsState) noteBackup(err error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.backupFailure = ""
	if err != nil {
		o.backupFailure = message(err)
	}
}

// operatorProblems are the problems besides the readers and the clock, keyed so each is told once.
func operatorProblems(app core.App, at time.Time) map[string]string {
	problems := map[string]string{}
	add := func(key, text string) {
		if text != "" {
			problems[key] = text
		}
	}
	add("backup", backupProblem(app, at))
	for name, text := range jobProblems(app, at) {
		add("job:"+name, text)
	}
	add("storage", storageProblem(app))
	add("armory", armoryProblem(app, at))
	add("push", pushProblem(app))
	if failures, last := stateOf(app).ops.discord.read(); failures >= streakAlert {
		add("discord", fmt.Sprintf("Odyle alert: the last %d Discord posts and edits for rooms failed (%s). Discord may be down, or the server cannot reach discord.com.", failures, plain(last)))
	}
	return problems
}

func backupProblem(app core.App, at time.Time) string {
	s := stateOf(app)
	s.ops.mu.Lock()
	failure := s.ops.backupFailure
	s.ops.mu.Unlock()
	if failure != "" {
		return "Odyle alert: the last backup failed (" + plain(failure) + "). Check the backup storage and make one under Settings → Backups."
	}
	// Scheduled backups switched off are the operator's choice; Server status warns of them.
	due := lastDue(app.Settings().Backups.Cron, at.Add(-backupGrace))
	served := s.ops.servedAt.Load()
	if due.IsZero() || served == 0 || sinceStart(due) < served {
		return ""
	}
	_, latest, failure := s.backups.read(app)
	if failure != "" {
		// Listing failed: whether the backup was made is unknown, and a backup that failed is told above.
		return ""
	}
	if latest != nil {
		if made, err := time.Parse(isoLayout, latest.At); err == nil && !made.Before(due) {
			return ""
		}
	}
	return "Odyle alert: the backup scheduled for " + due.UTC().Format("2006-01-02 15:04") + " UTC was not made. Check the server log, and make one under Settings → Backups."
}

// lastDue is the latest minute at or before the given time that the cron schedule runs at (UTC,
// as PocketBase's cron), within the last 8 days; zero when there is none or no schedule.
func lastDue(schedule string, before time.Time) time.Time {
	if schedule == "" {
		return time.Time{}
	}
	parsed, err := cron.NewSchedule(schedule)
	if err != nil {
		return time.Time{}
	}
	at := before.UTC().Truncate(time.Minute)
	for range 8 * 24 * 60 {
		if parsed.IsDue(cron.NewMoment(at)) {
			return at
		}
		at = at.Add(-time.Minute)
	}
	return time.Time{}
}

// jobProblems are the jobs, by name, that have ended in an error for brokenFor. The odyle-health
// job is left out (it fails when the alert itself cannot be posted), and so are paused jobs (their
// runs are skipped).
func jobProblems(app core.App, at time.Time) map[string]string {
	s := stateOf(app)
	out := map[string]string{}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, name := range jobNames {
		record := s.jobs[name]
		if name == "odyle-health" || record == nil || record.BrokenSince == "" || record.Skipped == "paused" {
			continue
		}
		since, err := time.Parse(isoLayout, record.BrokenSince)
		if err != nil || at.Sub(since) < brokenFor {
			continue
		}
		out[name] = "Odyle alert: the background job " + name + " has ended in an error since " + since.UTC().Format("2006-01-02 15:04") + " UTC: " + plain(record.LastError) + " See Odyle → Background jobs."
	}
	return out
}

func storageProblem(app core.App) string {
	s := stateOf(app)
	s.mu.Lock()
	move := s.storageMove
	s.mu.Unlock()
	if move == nil || move.Failed == 0 {
		return ""
	}
	return fmt.Sprintf("Odyle alert: %d files could not be moved into the S3 storage (%s). They stay on disk and the next start tries again.", move.Failed, plain(move.Error))
}

// armoryProblem: the armory's counters, compared with the last look, tell how many lookups failed
// since one worked. Whoever looks (the job, Server status) moves the count on, so it does not
// depend on how often anyone looks.
func armoryProblem(app core.App, at time.Time) string {
	s := stateOf(app)
	w := s.armory
	w.mu.Lock()
	done, failed, blocked, last := w.done, w.failed, w.blocked, w.lastError
	w.mu.Unlock()
	o := &s.ops
	o.mu.Lock()
	if done > o.armoryDone {
		o.armoryFailures, o.armoryRefused = 0, false
	}
	if failed > o.armoryFailed {
		o.armoryFailures += failed - o.armoryFailed
	}
	if blocked.After(at) {
		o.armoryRefused = true
	}
	o.armoryDone, o.armoryFailed = done, failed
	failures, refused := o.armoryFailures, o.armoryRefused
	o.mu.Unlock()
	// A paused armory asks nothing of PLAYNC.
	if readSettings(app).ArmoryPaused {
		return ""
	}
	switch {
	case blocked.After(at):
		return "Odyle alert: PLAYNC refused the armory's lookups; the queue waits until " + blocked.UTC().Format("15:04") + " UTC. If it keeps happening, pause the armory under Server controls for a while."
	case refused:
		return "Odyle alert: PLAYNC refused the armory's lookups, and none has worked since. If it keeps happening, pause the armory under Server controls for a while."
	case failures >= armoryFailing:
		return fmt.Sprintf("Odyle alert: the last %d armory lookups failed (%s). PLAYNC may be down or have changed its pages; see Server status → Armory.", failures, plain(last))
	}
	return ""
}

func pushProblem(app core.App) string {
	if problem := vapidProblem(); problem != "" {
		return "Odyle alert: ODYLE_VAPID_PRIVATE_KEY " + problem + ", so no push message can be sent. Set it to a P-256 private key (base64url), or remove it to use the key the server made (docs/deployment.md)."
	}
	if failures, last := stateOf(app).ops.push.read(); failures >= streakAlert {
		return fmt.Sprintf("Odyle alert: the last %d push messages could not be delivered (%s). Check the server's outbound HTTPS to the push services (docs/deployment.md).", failures, plain(last))
	}
	return ""
}

// vapidProblem says what is wrong with ODYLE_VAPID_PRIVATE_KEY, without making or reading a key
// file (vapid does that when it is unset); empty when it is unset or a key.
func vapidProblem() string {
	raw := strings.TrimSpace(os.Getenv("ODYLE_VAPID_PRIVATE_KEY"))
	if raw == "" {
		return ""
	}
	if _, err := parseVapid(raw); err != nil {
		return "is wrong: " + err.Error()
	}
	return ""
}

// clearedText is the message for a problem that cleared.
func clearedText(key string) string {
	name, detail, _ := strings.Cut(key, ":")
	switch name {
	case "adapter":
		return "Odyle: cleared, no more readings arrive under the refused adapter " + plain(detail) + "."
	case "clock":
		return "Odyle: cleared, the login readings match the Odyle clock again."
	case "backup":
		return "Odyle: cleared, the backups work again."
	case "job":
		return "Odyle: cleared, the background job " + detail + " runs without an error again."
	case "storage":
		return "Odyle: cleared, no file waits to be moved into the S3 storage."
	case "armory":
		return "Odyle: cleared, PLAYNC answers the armory again."
	case "push":
		return "Odyle: cleared, push messages are delivered again."
	case "discord":
		return "Odyle: cleared, Discord takes the rooms' posts again."
	}
	return "Odyle: cleared, the apps read Odyle again."
}

// problemList is the problems for Server status, without the "Odyle alert: " every message starts with.
func problemList(problems map[string]string) []any {
	keys := make([]string, 0, len(problems))
	for key := range problems {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]any, 0, len(keys))
	for _, key := range keys {
		out = append(out, newObject().set("key", key).set("message", strings.TrimPrefix(problems[key], "Odyle alert: ")))
	}
	return out
}

// watchServing notes when the server began to serve, and answers GET /api/health with 503 when
// the server is unhealthy in a way a restart can mend (serverHealth).
func watchServing(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		stateOf(se.App).ops.servedAt.CompareAndSwap(0, sinceStart(time.Now()))
		se.Router.BindFunc(func(e *core.RequestEvent) error {
			if e.Request.URL.Path != "/api/health" {
				return e.Next()
			}
			if problem := serverHealth(e.App, time.Now()); problem != "" {
				return e.JSON(503, map[string]any{"code": 503, "message": problem, "data": map[string]any{}})
			}
			return e.Next()
		})
		return se.Next()
	})
}

// serverHealth is what a restart could mend, empty when there is nothing: the data folder takes
// no file (a disk mounted read-only, or full), or the cron has not started a job for cronSilent.
// A look is reused for healthCheckAge.
func serverHealth(app core.App, at time.Time) string {
	s := stateOf(app)
	o := &s.ops
	o.checkMu.Lock()
	defer o.checkMu.Unlock()
	if !o.checkedAt.IsZero() && at.Sub(o.checkedAt) < healthCheckAge && at.After(o.checkedAt) {
		return o.checkProblem
	}
	problem := ""
	if err := writeTest(app.DataDir()); err != nil {
		problem = "The server cannot write to its data folder."
		warn(app, "Odyle health check: the data folder takes no file", "error", err.Error())
	} else if !s.byHand.Load() {
		// Tests run the jobs themselves; the cron never starts there.
		last := o.cronAt.Load()
		if last == 0 {
			last = o.servedAt.Load()
		}
		if silent := time.Duration(sinceStart(at) - last); last != 0 && silent > cronSilent {
			problem = fmt.Sprintf("The scheduled jobs have not run for %d minutes.", int(silent.Minutes()))
			warn(app, "Odyle health check: the cron has stopped", "minutes", int(silent.Minutes()))
		}
	}
	o.checkedAt, o.checkProblem = at, problem
	return problem
}

// writeTest writes, syncs and deletes a small file in the folder.
func writeTest(dir string) error {
	f, err := os.CreateTemp(dir, ".odyle-health-*")
	if err != nil {
		return err
	}
	name := f.Name()
	_, err = f.WriteString("ok")
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if removeErr := os.Remove(name); err == nil {
		err = removeErr
	}
	return err
}

// drain waits for the group, at most the given time; false when it gave up.
func drain(group *sync.WaitGroup, limit time.Duration) bool {
	done := make(chan struct{})
	go func() {
		group.Wait()
		close(done)
	}()
	select {
	case <-done:
		return true
	case <-time.After(limit):
		return false
	}
}
