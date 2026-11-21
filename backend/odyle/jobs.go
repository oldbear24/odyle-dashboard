package odyle

import (
	"fmt"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
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
	// BrokenSince is when the job's runs began to end in an error (an error the job returned or a
	// panic, not the failed items of a run that did its work); empty once a run ends without one.
	// The odyle-health job tells the operator of a job broken for brokenFor (alerts.go).
	BrokenSince string `json:"brokenSince,omitempty"`
}

type job struct {
	schedule string
	manual   bool
	pause    func(settings) bool
	work     func(core.App) (result, error)
}

var jobNames = []string{"odyle-expiry", "odyle-portraits", "odyle-reminders", "odyle-retention", "odyle-old-characters", "odyle-stats", "odyle-health", "odyle-release", "odyle-cap-alerts", "odyle-push", "odyle-party-ready", "odyle-armory", "odyle-armory-scout", "odyle-announcement"}

var jobs = map[string]job{
	"odyle-expiry":         {schedule: "*/5 * * * *", manual: true, work: cleanup},
	"odyle-portraits":      {schedule: "* * * * *", manual: true, pause: func(s settings) bool { return s.PortraitsPaused }, work: refreshPortraits},
	"odyle-reminders":      {schedule: "* * * * *", manual: true, pause: func(s settings) bool { return s.RemindersPaused }, work: remindRuns},
	"odyle-retention":      {schedule: "17 3 * * *", manual: false, work: retention},
	"odyle-old-characters": {schedule: "29 3 * * *", manual: true, work: oldCharacters},
	"odyle-stats":          {schedule: "55 23 * * *", manual: true, work: recordStats},
	"odyle-health":         {schedule: "*/5 * * * *", manual: true, work: checkHealth},
	"odyle-release":        {schedule: "*/2 * * * *", manual: true, work: checkRelease},
	"odyle-cap-alerts":     {schedule: "5 * * * *", manual: true, work: capAlerts},
	"odyle-push":           {schedule: "* * * * *", manual: true, work: pushReminders},
	"odyle-party-ready":    {schedule: "* * * * *", manual: true, work: partyReady},
	"odyle-armory":         {schedule: "41 4 * * *", manual: true, work: armoryNight},
	"odyle-armory-scout":   {schedule: "* * * * *", manual: true, pause: func(s settings) bool { return s.ArmoryPaused }, work: scoutArmory},
	"odyle-announcement":   {schedule: "* * * * *", manual: true, work: announcementSchedule},
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
// scheduled run, or the other way round) is not started twice, however long it runs: the
// lock carries the run's id and only that run lifts it. (It expired after ten minutes once,
// and a longer run then ran twice, the first one's end lifting the second one's lock.)
func runJob(app core.App, name string, manual bool) result {
	j, s := jobs[name], stateOf(app)
	s.mu.Lock()
	if _, ok := s.running[name]; ok {
		s.mu.Unlock()
		return result{Skipped: "running"}
	}
	s.runIds++
	id := s.runIds
	s.running[name] = id
	s.mu.Unlock()

	started := time.Now()
	out, broke := work(app, name, j)
	ms := time.Since(started).Milliseconds()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[name] == id {
		delete(s.running, name)
	}
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
	switch {
	case broke && next.BrokenSince == "":
		next.BrokenSince = at
	case !broke && out.Skipped == "":
		next.BrokenSince = ""
	}
	s.jobs[name] = &next
	return out
}

// work runs the job's function; an error or a panic is a failed run, and broke.
func work(app core.App, name string, j job) (out result, broke bool) {
	defer func() {
		if r := recover(); r != nil {
			out, broke = result{Failed: 1, Error: fmt.Sprint(r)}, true
			warn(app, "Odyle job failed", "job", name, "error", fmt.Sprint(r))
		}
	}()
	out, err := j.work(app)
	if err != nil {
		warn(app, "Odyle job failed", "job", name, "error", message(err))
		return result{Failed: 1, Error: message(err)}, true
	}
	return out, false
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
		app.Cron().MustAdd(name, jobs[name].schedule, func() {
			// The health check fails when the cron stops ticking (alerts.go).
			stateOf(app).ops.cronAt.Store(sinceStart(time.Now()))
			runJob(app, name, false)
		})
	}
}
