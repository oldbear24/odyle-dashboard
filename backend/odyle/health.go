package odyle

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Reader health. A Windows app's heartbeat may say what its reader is doing (reader) and
// which game build it reads (game: Steam's build id of the client). The backend keeps the
// latest of each reader session in server memory only, like heartbeats, and shows it on the
// superuser Apps page and Server status. The odyle-health job tells the operator when the
// decoder looks broken: most apps connected to the game have listened for ten minutes
// without reading any Odyle (a game patch, most likely), or readings arrive under an adapter
// name this backend refuses (a Windows release that shipped before its backend). The alert
// goes to the Discord webhook in ODYLE_ALERT_WEBHOOK, once when a problem starts and once
// when it clears.

// What a reader can report: no game connection, connected but no Odyle read on this
// connection yet, started after login (or resyncing), Odyle read, a capture problem, Npcap
// missing or restricted, two game clients on the PC, paused by the server, stopped by hand.
var readerStatuses = map[string]bool{"waiting": true, "listening": true, "midstream": true, "reading": true, "problem": true, "npcap": true, "two-clients": true, "paused": true, "stopped": true}

// A game build as the app reports it, for example "Steam build 25800038".
var gameBuildText = regexp.MustCompile(`^[A-Za-z0-9 ._-]{1,40}$`)

// silentFor is how long a reader may listen to the game without reading Odyle before it
// counts as stuck: a login snapshot comes within seconds, and the game names the character
// within a few minutes even when the reader started after login.
const silentFor = 10 * time.Minute

type readerReport struct {
	status, game string
	since, at    time.Time
}

type health struct {
	mu      sync.Mutex
	readers map[string]readerReport // by reader session
	alerted map[string]string       // problems the operator was told about, with the message
	clock   []clockCheck            // login readings compared with the Odyle clock (clock.go)
}

func newHealth() *health {
	return &health{readers: map[string]readerReport{}, alerted: map[string]string{}}
}

func healthOf(app core.App) *health { return stateOf(app).health }

// noteReader keeps what a heartbeat said about its session's reader; a missing or unknown
// status is ignored, and a game build that is not plain text is left out.
func noteReader(app core.App, session string, b body, at time.Time) {
	if !b.set("reader") || !readerStatuses[b.str("reader")] {
		return
	}
	game := ""
	if b.set("game") && gameBuildText.MatchString(b.str("game")) {
		game = b.str("game")
	}
	h := healthOf(app)
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.readers[session]
	if !ok || r.status != b.str("reader") {
		r.since = at
	}
	r.status, r.game, r.at = b.str("reader"), game, at
	h.readers[session] = r
}

// readerOf is a session's latest report while it is current.
func readerOf(app core.App, session string, at time.Time) (readerReport, bool) {
	h := healthOf(app)
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.readers[session]
	return r, ok && at.Sub(r.at) <= presenceKept
}

func (h *health) forget(session string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.readers, session)
}

// readerHealth sums up the current reports: how many readers report, by status and by game
// build, how many are stuck (listening for silentFor without reading Odyle), and the
// problems worth an alert, keyed so each is told once.
func readerHealth(app core.App, at time.Time) (*object, map[string]string) {
	h := healthOf(app)
	byStatus, games := map[string]int{}, map[string]int{}
	reporting, connected, stuck := 0, 0, 0
	h.mu.Lock()
	for session, r := range h.readers {
		if at.Sub(r.at) > presenceKept {
			delete(h.readers, session)
			continue
		}
		reporting++
		byStatus[r.status]++
		if r.game != "" {
			games[r.game]++
		}
		switch r.status {
		case "listening", "midstream", "reading":
			connected++
		}
		if r.status == "listening" && at.Sub(r.since) >= silentFor {
			stuck++
		}
	}
	h.mu.Unlock()
	problems := map[string]string{}
	if stuck >= 2 && stuck*2 >= connected {
		problems["stuck"] = fmt.Sprintf("Odyle alert: %d of %d apps connected to the game have read no Odyle for %d minutes%s. A game patch may have changed the packets: pause the readers or switch the adapter off under Server controls, then follow \"When a game patch breaks reading\" in the Windows app's docs/packet-reader.md.", stuck, connected, int(silentFor.Minutes()), buildsNote(games))
	}
	accepted := map[string]bool{}
	for _, name := range acceptedAdapters(app) {
		accepted[name] = true
	}
	refused := []string{}
	for _, entry := range seenAdapters(app) {
		e := entry.(*object)
		name, _ := e.values["name"].(string)
		if n, _ := e.values["rejected"].(int); n > 0 && !accepted[name] {
			refused = append(refused, name)
			problems["adapter:"+name] = "Odyle alert: readings arrive under the packet adapter " + plain(name) + ", which this backend refuses, so they are not saved. Accept it under Server controls, or deploy the backend that lists it."
		}
	}
	statuses := newObject()
	for _, s := range sortedKeys(byStatus) {
		statuses.set(s, byStatus[s])
	}
	builds := []any{}
	for _, g := range sortedKeys(games) {
		builds = append(builds, newObject().set("game", g).set("apps", games[g]))
	}
	clock, missed := clockHealth(app, at)
	for key, message := range missed {
		problems[key] = message
	}
	return newObject().set("reporting", reporting).set("connected", connected).set("stuck", stuck).set("statuses", statuses).
		set("games", builds).set("refusedAdapters", refused).set("clock", clock).set("problems", len(problems)).set("alerts", alertWebhook() != ""), problems
}

func buildsNote(games map[string]int) string {
	if len(games) == 0 {
		return ""
	}
	return " (" + plain(joinKeys(sortedKeys(games))) + ")"
}

func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func joinKeys(keys []string) string {
	out := ""
	for i, k := range keys {
		if i > 0 {
			out += ", "
		}
		out += k
	}
	return out
}

// alertWebhook is the operator's Discord webhook for alerts, from ODYLE_ALERT_WEBHOOK; empty
// when unset or not a Discord webhook URL.
func alertWebhook() string {
	link, err := webhook(os.Getenv("ODYLE_ALERT_WEBHOOK"))
	if err != nil {
		return ""
	}
	return link
}

// watchHealth forgets a session's report when the session ends.
func watchHealth(app core.App) {
	app.OnRecordAfterDeleteSuccess("publisher_sessions").BindFunc(func(e *core.RecordEvent) error {
		healthOf(e.App).forget(e.Record.Id)
		return e.Next()
	})
}

// checkHealth is the odyle-health job: it tells the operator of each problem once when it
// starts and once when it clears. Without ODYLE_ALERT_WEBHOOK it only keeps the reports
// current; Server status shows them either way.
func checkHealth(app core.App) (result, error) {
	_, problems := readerHealth(app, time.Now())
	link := alertWebhook()
	if link == "" {
		if os.Getenv("ODYLE_ALERT_WEBHOOK") != "" {
			return result{}, fmt.Errorf("ODYLE_ALERT_WEBHOOK is not a Discord webhook URL")
		}
		return result{Skipped: "off"}, nil
	}
	h := healthOf(app)
	h.mu.Lock()
	var tell []string
	for key, message := range problems {
		if _, told := h.alerted[key]; !told {
			tell = append(tell, key)
			h.alerted[key] = message
		}
	}
	var cleared []string
	for key := range h.alerted {
		if _, still := problems[key]; !still {
			cleared = append(cleared, key)
			delete(h.alerted, key)
		}
	}
	h.mu.Unlock()
	sort.Strings(tell)
	sort.Strings(cleared)
	out := result{}
	post := func(key, text string) {
		if res, err := postWebhook(link, map[string]any{"content": text}, nil); err != nil || res.status >= 300 {
			out.fail("Discord did not take the alert")
			// Told again at the next run.
			h.mu.Lock()
			if key != "" {
				delete(h.alerted, key)
			}
			h.mu.Unlock()
			return
		}
		out.Done++
	}
	for _, key := range tell {
		post(key, problems[key])
	}
	for _, key := range cleared {
		what := "the apps read Odyle again"
		if len(key) > 8 && key[:8] == "adapter:" {
			what = "no more readings arrive under the refused adapter " + plain(key[8:])
		}
		post("", "Odyle: cleared, "+what+".")
	}
	return out, nil
}
