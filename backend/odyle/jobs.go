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
// result is what a job run did: how many things it did and how many failed, with the
// last failure's error, or why it was skipped ('paused', 'off', 'clock' or 'running').
type result struct {
	Done    int    `json:"done"`
	Failed  int    `json:"failed"`
	Error   string `json:"error,omitempty"`
	Skipped string `json:"skipped,omitempty"`
}

// fail counts a failure; its text is the run's error.
func (r *result) fail(text string) {
	r.Failed++
	r.Error = text
}

// jobRecord is a job's runs since the server started, for the Background jobs page.
type jobRecord struct {
	Runs          int    `json:"runs"`
	FailedRuns    int    `json:"failedRuns"`
	TotalDone     int    `json:"totalDone"`
	LastRunAt     string `json:"lastRunAt"`
	Ms            int64  `json:"ms"`
	ByHand        bool   `json:"byHand"`
	Done          int    `json:"done"`
	Failed        int    `json:"failed"`
	Error         string `json:"error"`
	Skipped       string `json:"skipped"`
	LastFailureAt string `json:"lastFailureAt,omitempty"`
	LastError     string `json:"lastError,omitempty"`
}

type job struct {
	schedule string
	manual   bool
	pause    func(settings) bool
	work     func(core.App) (result, error)
}

var jobNames = []string{"odyle-expiry", "odyle-portraits", "odyle-reminders", "odyle-retention", "odyle-stats", "odyle-health", "odyle-release", "odyle-cap-alerts"}

var jobs = map[string]job{
	"odyle-expiry":     {schedule: "*/5 * * * *", manual: true, work: cleanup},
	"odyle-portraits":  {schedule: "* * * * *", manual: true, pause: func(s settings) bool { return s.PortraitsPaused }, work: refreshPortraits},
	"odyle-reminders":  {schedule: "* * * * *", manual: true, pause: func(s settings) bool { return s.RemindersPaused }, work: remindRuns},
	"odyle-retention":  {schedule: "17 3 * * *", manual: false, work: retention},
	"odyle-stats":      {schedule: "55 23 * * *", manual: true, work: recordStats},
	"odyle-health":     {schedule: "*/5 * * * *", manual: true, work: checkHealth},
	"odyle-release":    {schedule: "*/2 * * * *", manual: true, work: checkRelease},
	"odyle-cap-alerts": {schedule: "5 * * * *", manual: true, work: capAlerts},
}

// nextDaily is when a daily schedule ("minute hour * * *", UTC like every job) runs next,
// at or after the given time.
func nextDaily(schedule string, at time.Time) time.Time {
	var minute, hour int
	_, _ = fmt.Sscanf(schedule, "%d %d", &minute, &hour)
	at = at.UTC()
	next := time.Date(at.Year(), at.Month(), at.Day(), hour, minute, 0, 0, time.UTC)
	if next.Before(at) {
		next = next.Add(24 * time.Hour)
	}
	return next
}

// runJob runs one job and records it. A job still running (a manual start during its
// scheduled run, or the other way round) is not started twice; a lock older than ten
// minutes is ignored.
func runJob(app core.App, name string, manual bool) result {
	j, s := jobs[name], stateOf(app)
	s.mu.Lock()
	if since, ok := s.running[name]; ok && time.Since(since) < 10*time.Minute {
		s.mu.Unlock()
		return result{Skipped: "running"}
	}
	s.running[name] = time.Now()
	s.mu.Unlock()

	started := time.Now()
	out := work(app, name, j)
	ms := time.Since(started).Milliseconds()

	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.running, name)
	next := jobRecord{}
	if last := s.jobs[name]; last != nil {
		next = *last
	}
	at := now()
	next.LastRunAt, next.Ms, next.ByHand = at, ms, manual
	next.Done, next.Failed, next.Error, next.Skipped = out.Done, out.Failed, out.Error, out.Skipped
	next.Runs++
	next.TotalDone += out.Done
	// The last failure stays listed after later runs succeed.
	if out.Failed > 0 {
		next.FailedRuns++
		next.LastFailureAt, next.LastError = at, out.Error
		if next.LastError == "" {
			next.LastError = "Failed without a message."
		}
	}
	s.jobs[name] = &next
	return out
}

// work runs the job's function; an error or a panic is a failed run.
func work(app core.App, name string, j job) (out result) {
	defer func() {
		if r := recover(); r != nil {
			out = result{Failed: 1, Error: fmt.Sprint(r)}
			warn(app, "Odyle job failed", "job", name, "error", fmt.Sprint(r))
		}
	}()
	out, err := j.work(app)
	if err != nil {
		warn(app, "Odyle job failed", "job", name, "error", message(err))
		return result{Failed: 1, Error: message(err)}
	}
	return out
}

// jobEntry is a job on the Background jobs page: its runs (none before the first) and
// whether it runs by hand, is paused or off, and runs now.
type jobEntry struct {
	Name string `json:"name"`
	*jobRecord
	Manual  bool   `json:"manual"`
	State   string `json:"state"`
	Running bool   `json:"running"`
}

func jobList(app core.App) []jobEntry {
	current, s := readSettings(app), stateOf(app)
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]jobEntry, len(jobNames))
	for i, name := range jobNames {
		j, state := jobs[name], "active"
		if j.pause != nil && j.pause(current) {
			state = "paused"
		} else if name == "odyle-retention" && current.InactiveAccountDays == 0 {
			state = "off"
		}
		_, running := s.running[name]
		out[i] = jobEntry{Name: name, jobRecord: s.jobs[name], Manual: j.manual, State: state, Running: running}
	}
	return out
}

func scheduleJobs(app core.App) {
	for _, name := range jobNames {
		app.Cron().MustAdd(name, jobs[name].schedule, func() { runJob(app, name, false) })
	}
}
