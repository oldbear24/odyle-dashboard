package odyle

import (
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Background jobs. Each run is recorded, so the superuser dashboard's Odyle →
// Background jobs page shows when each job last ran, how long it took, what it did and
// its last failure. Like packets this lives in server memory only: a restart clears
// it. Superusers can also start the routine jobs by hand; the account clean-up only
// runs on its schedule.
//
// Each job answers { done, failed, error } or { skipped: 'paused' | 'off' }.
type result = map[string]any

type job struct {
	schedule string
	manual   bool
	pause    func(settings) bool
	work     func(core.App) (result, error)
}

var jobNames = []string{"odyle-expiry", "odyle-portraits", "odyle-reminders", "odyle-retention"}

var jobs = map[string]job{
	"odyle-expiry":    {schedule: "*/5 * * * *", manual: true, work: cleanup},
	"odyle-portraits": {schedule: "* * * * *", manual: true, pause: func(s settings) bool { return s.PortraitsPaused }, work: refreshPortraits},
	"odyle-reminders": {schedule: "* * * * *", manual: true, pause: func(s settings) bool { return s.RemindersPaused }, work: remindRuns},
	"odyle-retention": {schedule: "17 3 * * *", manual: false, work: retention},
}

// runJob runs one job and records it. A job still running (a manual start during its
// scheduled run, or the other way round) is not started twice; a lock older than ten
// minutes is ignored.
func runJob(app core.App, name string, manual bool) result {
	j, s := jobs[name], stateOf(app)
	s.mu.Lock()
	if since, ok := s.running[name]; ok && time.Since(since) < 10*time.Minute {
		s.mu.Unlock()
		return result{"skipped": "running"}
	}
	s.running[name] = time.Now()
	s.mu.Unlock()

	started := time.Now()
	out := work(app, name, j)
	ms := time.Since(started).Milliseconds()

	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.running, name)
	last := s.jobs[name]
	if last == nil {
		last = map[string]any{"runs": 0, "failedRuns": 0, "totalDone": 0}
	}
	at, done, failed := now(), count(out["done"]), count(out["failed"])
	next := map[string]any{}
	for k, v := range last {
		next[k] = v
	}
	next["lastRunAt"], next["ms"], next["byHand"] = at, ms, manual
	next["done"], next["failed"], next["error"], next["skipped"] = done, failed, textOf(out["error"]), textOf(out["skipped"])
	next["runs"], next["totalDone"] = count(last["runs"])+1, count(last["totalDone"])+done
	next["failedRuns"] = count(last["failedRuns"])
	// The last failure stays listed after later runs succeed.
	if failed > 0 {
		next["failedRuns"] = count(last["failedRuns"]) + 1
		next["lastFailureAt"] = at
		next["lastError"] = textOf(out["error"])
		if next["lastError"] == "" {
			next["lastError"] = "Failed without a message."
		}
	}
	s.jobs[name] = next
	return out
}

// work runs the job's function; an error or a panic is a failed run.
func work(app core.App, name string, j job) (out result) {
	defer func() {
		if r := recover(); r != nil {
			out = result{"failed": 1, "error": fmt.Sprint(r)}
			warn(app, "Odyle job failed", "job", name, "error", fmt.Sprint(r))
		}
	}()
	out, err := j.work(app)
	if err != nil {
		warn(app, "Odyle job failed", "job", name, "error", message(err))
		return result{"failed": 1, "error": message(err)}
	}
	if out == nil {
		out = result{}
	}
	return out
}

func count(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	}
	return 0
}

func jobList(app core.App) []any {
	current, s := readSettings(app), stateOf(app)
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]any, len(jobNames))
	for i, name := range jobNames {
		j, state := jobs[name], "active"
		if j.pause != nil && j.pause(current) {
			state = "paused"
		} else if name == "odyle-retention" && current.InactiveAccountDays == 0 {
			state = "off"
		}
		// The job's own fields come last, so a run record can never hide them.
		entry := newObject().set("name", name)
		for _, key := range []string{"runs", "failedRuns", "totalDone", "lastRunAt", "ms", "byHand", "done", "failed", "error", "skipped", "lastFailureAt", "lastError"} {
			if v, ok := s.jobs[name][key]; ok {
				entry.set(key, v)
			}
		}
		_, running := s.running[name]
		out[i] = entry.set("manual", j.manual).set("state", state).set("running", running)
	}
	return out
}

func scheduleJobs(app core.App) {
	for _, name := range jobNames {
		app.Cron().MustAdd(name, jobs[name].schedule, func() { runJob(app, name, false) })
	}
}
