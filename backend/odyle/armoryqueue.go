package odyle

import (
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// armoryProgress is how far the running lookup got, for the reader's progress bar: its step
// (profile, images, items or boards), how much of that step is done, and the whole lookup
// in percent.
type armoryProgress struct {
	Step    string `json:"step"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Percent int    `json:"percent"`
}

// armoryTrack follows the running lookup for its readers: its progress and, once PLAYNC's
// character pages are read, the profile without the items' and boards' details (as JSON),
// which a reader with no kept profile sees while those load. The steps come in this order:
// profile (info and equipment), images, items, boards and the details' images. A page of
// PLAYNC counts as one in the percent and an image, downloaded side by side with others,
// as a tenth. All methods take a nil track.
type armoryTrack struct {
	mu            sync.Mutex
	progress      armoryProgress
	stage         int     // steps begun
	worth         float64 // what one unit of the running step counts for
	finished      float64 // units of the earlier steps and of the running one done
	items, boards int     // pages of details, as many as a character at the level cap until known
	partial       string
}

const imageWorth = 0.1

func newArmoryTrack() *armoryTrack { return &armoryTrack{items: 20, boards: 4} }

// begin starts the lookup's next step, of total units each worth worth.
func (t *armoryTrack) begin(step string, total int, worth float64) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.stage++
	t.worth = worth
	t.progress.Step, t.progress.Done, t.progress.Total = step, 0, total
	t.count()
}

// tick counts one unit of the running step done.
func (t *armoryTrack) tick() {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.progress.Done = min(t.progress.Done+1, t.progress.Total)
	t.finished += t.worth
	t.count()
}

// count works out the percent: what is done of what is done plus the rest of the running
// step and the steps after it (half a unit for the details' images). It never goes back,
// and reaches 100 only when the lookup ends.
func (t *armoryTrack) count() {
	left := float64(t.progress.Total-t.progress.Done) * t.worth
	switch t.stage {
	case 1, 2:
		left += float64(t.items+t.boards) + 0.5
	case 3:
		left += float64(t.boards) + 0.5
	case 4:
		left += 0.5
	}
	if all := t.finished + left; all > 0 {
		t.progress.Percent = max(t.progress.Percent, min(99, int(100*t.finished/all)))
	}
}

// plan sets how many pages of details the lookup asks for, once PLAYNC's character pages say.
func (t *armoryTrack) plan(items, boards int) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.items, t.boards = items, boards
	t.count()
}

// show keeps the profile as read so far for readers.
func (t *armoryTrack) show(p *armoryProfile) {
	if t == nil {
		return
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.partial = string(raw)
}

// read is the progress so far and the profile as read so far ("" before PLAYNC's character
// pages are).
func (t *armoryTrack) read() (*armoryProgress, string) {
	if t == nil {
		return nil, ""
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	progress := t.progress
	return &progress, t.partial
}

// armoryJob is a lookup waiting in the queue: a reader's (a profile, and the address that asked
// for it) or, auto, the scout's (a top player's gear, scout.go).
type armoryJob struct {
	key, region, characterId, address string
	serverId                          int
	auto                              bool
	queuedAt                          time.Time
}

func armoryKey(serverId int, characterId string) string {
	return strconv.Itoa(serverId) + "/" + characterId
}

// scoutKey is the queue's key of the scout's lookup of a character: apart from a reader's, so a
// reader never follows a lookup that keeps no profile.
func scoutKey(serverId int, characterId string) string {
	return "scout/" + armoryKey(serverId, characterId)
}

// armoryMiss keeps a character that could not be looked up from being asked for again
// before until.
type armoryMiss struct {
	until   time.Time
	missing bool // PLAYNC does not list it
	error   string
}

// armoryState is where a profile's lookup stands, for the reader: queued (position profiles
// ahead, about wait seconds), fetching (with its progress and the profile read so far),
// failed (error), busy (the queue or the address has no room), paused, missing or fresh
// (nothing to do).
type armoryState struct {
	State      string
	Position   int
	Wait       int
	RetryAfter int
	Error      string
	Progress   *armoryProgress
	Partial    string
}

// armoryRun is a lookup running now.
type armoryRun struct {
	job       armoryJob
	track     *armoryTrack
	startedAt time.Time
}

// armoryWork is the queue of lookups waiting for PLAYNC. Lanes work it, each its own goroutine
// while the queue holds work for it: up to readerLanes readers' lookups at once and, beside them,
// up to scoutLanes of the scout's, which start only while no reader's waits (both set under Server
// controls, settings.go). A lane starts its next lookup armoryPace after its last one ended, and
// ends when nothing waits for it.
type armoryWork struct {
	mu      sync.Mutex
	idle    *sync.Cond    // signalled when a lane ends
	wakeup  chan struct{} // closed to end the lanes' waits (dropped queue, PLAYNC lets the server ask again)
	waiting []armoryJob
	running map[string]*armoryRun // by key
	lanes   int                   // lanes working the queue

	readerLanes, scoutLanes int // how many of each run at once, as the settings last said
	byAddress               map[string]int
	misses                  map[string]armoryMiss
	blocked                 time.Time     // PLAYNC refused the server until then
	took                    time.Duration // how long readers' lookups last, on average
	lastAt                  time.Time
	lastError               string
	errorAt                 time.Time
	done                    int
	failed                  int
	failing                 int // lookups failed in a row since one worked (alerts.go)

	classesTried time.Time // PLAYNC's classes were last asked for (classes.go learnClassesFor)
}

func newArmoryWork() *armoryWork {
	w := &armoryWork{running: map[string]*armoryRun{}, byAddress: map[string]int{}, misses: map[string]armoryMiss{}, wakeup: make(chan struct{}), took: armoryTook,
		readerLanes: defaultArmoryLanes, scoutLanes: defaultScoutLanes}
	w.idle = sync.NewCond(&w.mu)
	return w
}

// later is the latest of the times.
func later(times ...time.Time) time.Time {
	out := times[0]
	for _, t := range times[1:] {
		if t.After(out) {
			out = t
		}
	}
	return out
}

// seconds is d in whole seconds, rounded up.
func seconds(d time.Duration) int { return int((max(0, d) + time.Second - 1) / time.Second) }

// counts are the readers' and the scout's lookups that run, and those that wait (w.mu held).
func (w *armoryWork) counts() (readers, scouts, readersWaiting, scoutsWaiting int) {
	for _, r := range w.running {
		if r.job.auto {
			scouts++
		} else {
			readers++
		}
	}
	for _, j := range w.waiting {
		if j.auto {
			scoutsWaiting++
		} else {
			readersWaiting++
		}
	}
	return
}

// limit takes the lanes the settings set (w.mu held).
func (w *armoryWork) limit(s settings) {
	w.readerLanes, w.scoutLanes = int(s.ArmoryLanes), int(s.ScoutLanes)
}

// resize takes the lanes the settings now set (Server controls); the next reader's request or
// lookup's end starts lanes for what may start then. It starts none itself: settings are saved
// inside a transaction, which a lane must not outlive.
func (w *armoryWork) resize(s settings) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.limit(s)
}

// next is the index of the lookup a free lane takes: the first reader's while fewer than
// readerLanes run, else the scout's while fewer than scoutLanes run and no reader's waits; -1 for
// none (w.mu held).
func (w *armoryWork) next() int {
	readers, scouts, readersWaiting, _ := w.counts()
	for i, j := range w.waiting {
		if !j.auto && readers < w.readerLanes || j.auto && scouts < w.scoutLanes && readersWaiting == 0 {
			return i
		}
	}
	return -1
}

// staff starts lanes for the lookups that could start now, beside the lanes already working or
// resting (w.mu held).
func (w *armoryWork) staff(app core.App) {
	readers, scouts, readersWaiting, scoutsWaiting := w.counts()
	ready := max(0, min(readersWaiting, w.readerLanes-readers))
	if readersWaiting == 0 {
		ready += max(0, min(scoutsWaiting, w.scoutLanes-scouts))
	}
	for w.lanes < len(w.running)+ready {
		w.lanes++
		go w.lane(app)
	}
}

// nudge ends the lanes' waits (w.mu held).
func (w *armoryWork) nudge() {
	close(w.wakeup)
	w.wakeup = make(chan struct{})
}

// queued is the state of the reader's lookup at index i of the queue. Its wait counts the
// readers' lookups running now and the ones ahead, spread over readerLanes lanes, each lasting
// as long as lookups do and armoryPace apart, and its own lookup. The reader asks again about
// when its own lookup starts, to follow it.
func (w *armoryWork) queued(i int, at time.Time) armoryState {
	start := later(w.blocked, at)
	free := []time.Time{}
	for _, r := range w.running {
		if !r.job.auto {
			free = append(free, later(start, r.startedAt.Add(w.took+armoryPace), at.Add(armoryPace)))
		}
	}
	running := len(free)
	for len(free) < max(1, w.readerLanes) {
		free = append(free, start)
	}
	ahead := 0
	for _, j := range w.waiting[:i] {
		if !j.auto {
			ahead++
		}
	}
	// The lookups ahead take the lanes as they come free, this one the next.
	for range ahead {
		slices.SortFunc(free, func(a, b time.Time) int { return a.Compare(b) })
		free[0] = free[0].Add(w.took + armoryPace)
	}
	slices.SortFunc(free, func(a, b time.Time) int { return a.Compare(b) })
	starts := free[0].Sub(at)
	// Ahead of it: the readers' lookups running and those waiting before it.
	return armoryState{State: "queued", Position: running + ahead, Wait: seconds(starts + w.took + time.Second), RetryAfter: min(max(seconds(starts), 2), 15)}
}

// ask queues a reader's lookup of a profile, unless it waits or runs already, or failed a
// moment ago, and says where it stands.
func (w *armoryWork) ask(app core.App, j armoryJob) armoryState {
	s := readSettings(app)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.limit(s)
	at := time.Now()
	if miss, ok := w.misses[j.key]; ok {
		if at.Before(miss.until) {
			if miss.missing {
				return armoryState{State: "missing", Error: errArmoryMissing.Error()}
			}
			return armoryState{State: "failed", Error: miss.error, RetryAfter: seconds(miss.until.Sub(at))}
		}
		delete(w.misses, j.key)
	}
	// Lanes the settings allow now that none started yet (more lanes set meanwhile).
	w.staff(app)
	if state, ok := w.pending(j.key, at); ok {
		return state
	}
	_, _, readersWaiting, _ := w.counts()
	if readersWaiting >= armoryQueueSize || w.byAddress[j.address] >= armoryPerAddress {
		return armoryState{State: "busy", RetryAfter: 30}
	}
	j.queuedAt = at
	w.waiting = append(w.waiting, j)
	w.byAddress[j.address]++
	w.staff(app)
	if state, ok := w.pending(j.key, at); ok {
		return state
	}
	return w.queued(len(w.waiting)-1, at)
}

// scout queues the scout's lookups of characters' gear (scout.go): up to n of hits, in their
// order, while fewer of its than may run at once wait or run. It queues none while a reader's
// waits or PLAYNC refuses the server, and passes over a character whose reader's lookup or the
// scout's waits or runs, or whose scout's lookup failed lately. It says how many it queued.
func (w *armoryWork) scout(app core.App, hits []scoutHit, n int) int {
	s := readSettings(app)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.limit(s)
	at := time.Now()
	_, scouts, readersWaiting, scoutsWaiting := w.counts()
	if readersWaiting > 0 || w.blocked.After(at) {
		return 0
	}
	queued := 0
	for _, hit := range hits {
		if queued >= n || scouts+scoutsWaiting+queued >= w.scoutLanes {
			break
		}
		key, own := armoryKey(hit.serverId, hit.characterId), scoutKey(hit.serverId, hit.characterId)
		if w.running[key] != nil || w.running[own] != nil || slices.ContainsFunc(w.waiting, func(j armoryJob) bool { return j.key == key || j.key == own }) {
			continue
		}
		if miss, ok := w.misses[own]; ok && at.Before(miss.until) {
			continue
		}
		w.waiting = append(w.waiting, armoryJob{key: own, region: hit.region, serverId: hit.serverId, characterId: hit.characterId, auto: true, queuedAt: at})
		queued++
	}
	if queued > 0 {
		w.staff(app)
	}
	return queued
}

// peek says where the profile's lookup stands while it waits or runs, without queuing it:
// a Refresh followed by the page asking again without it, or by another reader.
func (w *armoryWork) peek(key string) (armoryState, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.pending(key, time.Now())
}

// pending is the state of the profile's lookup while it runs or waits (w.mu held).
func (w *armoryWork) pending(key string, at time.Time) (armoryState, bool) {
	if r := w.running[key]; r != nil {
		progress, partial := r.track.read()
		return armoryState{State: "fetching", RetryAfter: 2, Progress: progress, Partial: partial}, true
	}
	for i, q := range w.waiting {
		if q.key == key {
			return w.queued(i, at), true
		}
	}
	return armoryState{}, false
}

// drop empties the queue (paused), and wakes the lanes waiting for PLAYNC so they end.
func (w *armoryWork) drop() {
	w.waiting, w.byAddress = nil, map[string]int{}
	w.nudge()
}

// lane works the queue: it takes the next lookup it may run (next), runs it, rests armoryPace,
// and ends when nothing waits for it.
func (w *armoryWork) lane(app core.App) {
	var rest time.Time // this lane starts its next lookup no earlier
	for {
		paused := readSettings(app).ArmoryPaused
		w.mu.Lock()
		if paused {
			w.drop()
		}
		i := w.next()
		if i < 0 {
			w.lanes--
			w.mu.Unlock()
			w.idle.Broadcast()
			return
		}
		if wait := time.Until(later(rest, w.blocked)); wait > 0 {
			wakeup := w.wakeup
			w.mu.Unlock()
			select {
			case <-time.After(wait):
			case <-wakeup:
			}
			continue
		}
		j := w.waiting[i]
		w.waiting = slices.Delete(w.waiting, i, i+1)
		if !j.auto {
			if w.byAddress[j.address]--; w.byAddress[j.address] <= 0 {
				delete(w.byAddress, j.address)
			}
		}
		run := &armoryRun{job: j, track: newArmoryTrack(), startedAt: time.Now()}
		w.running[j.key] = run
		w.mu.Unlock()
		var err error
		if j.auto {
			err = buildRank(app, scoutHit{region: j.region, serverId: j.serverId, characterId: j.characterId}, run.track)
		} else {
			err = lookUpArmory(app, j, run.track)
		}
		w.mu.Lock()
		at := time.Now()
		delete(w.running, j.key)
		w.lastAt, rest = at, at.Add(armoryPace)
		var refused armoryRefused
		switch {
		case err == nil:
			w.done, w.failing = w.done+1, 0
			if !j.auto {
				w.took = (3*w.took + at.Sub(run.startedAt)) / 4
			}
		case errors.Is(err, errArmoryMissing):
			w.misses[j.key] = armoryMiss{until: at.Add(armoryMissing), missing: true}
		default:
			w.failed++
			w.failing++
			w.lastError, w.errorAt = message(err), at
			w.misses[j.key] = armoryMiss{until: at.Add(armoryRetry), error: message(err)}
			if errors.As(err, &refused) {
				w.blocked = later(w.blocked, at.Add(max(refused.wait, armoryBlocked)))
			}
			warn(app, "Odyle armory lookup failed", "character", j.key, "error", message(err))
		}
		// Old misses go once there are many.
		if len(w.misses) > 1000 {
			for key, miss := range w.misses {
				if at.After(miss.until) {
					delete(w.misses, key)
				}
			}
		}
		// What a lookup ending lets start (the scout's, the next reader's) gets a lane.
		w.staff(app)
		w.mu.Unlock()
	}
}

// wait returns once the queue is worked off (tests).
func (w *armoryWork) wait() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for w.lanes > 0 {
		w.idle.Wait()
	}
}
