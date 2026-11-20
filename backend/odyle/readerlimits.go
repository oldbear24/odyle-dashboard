package odyle

import (
	"strconv"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Per-account budgets of the reader routes. The address rate limits (/api/odyle/) stop one
// address, not one account spread over several, and every reading is a database write and a
// row of history. An app sends a reading when a value it reads changes, a few a minute at
// most, so the budget only stops a runaway or hand-made client.
const readingsPerMinute = 120

// Reader sessions opened without a device key (apps paired before device keys, or a
// hand-made client) an account keeps open at most; the oldest end. A paired PC replaces its
// own session, so these only stop a flood the expiry job could not keep up with.
const keylessSessions = 5

// readingWindow counts an account's readings in the current minute.
type readingWindow struct {
	mu    sync.Mutex
	start time.Time
	count int
}

// allowReading notes a reading of the account and says whether it is within the budget, and
// if not, how long until it is.
func allowReading(app core.App, userId string, at time.Time) (bool, time.Duration) {
	raw, _ := stateOf(app).readings.LoadOrStore(userId, &readingWindow{})
	w := raw.(*readingWindow)
	w.mu.Lock()
	defer w.mu.Unlock()
	if at.Sub(w.start) >= time.Minute {
		w.start, w.count = at, 0
	}
	if w.count >= readingsPerMinute {
		return false, w.start.Add(time.Minute).Sub(at)
	}
	w.count++
	return true, 0
}

// tooManyReadings is the 429 an app answers by waiting as long as Retry-After says.
func tooManyReadings(e *core.RequestEvent, wait time.Duration) error {
	e.Response.Header().Set("Retry-After", strconv.Itoa(max(1, int(wait.Seconds()+0.999))))
	return apis.NewTooManyRequestsError("Too many readings from this account. Odyle tries again in a minute.", nil)
}

// endExtraSessions ends the keyless reader sessions of an account beyond the newest
// keylessSessions.
func endExtraSessions(app core.App, userId string) error {
	found, err := app.FindRecordsByFilter("publisher_sessions", "user = {:user} && device = ''", "-created,-id", 500, keylessSessions, dbx.Params{"user": userId})
	if err != nil {
		return err
	}
	for _, s := range views[ReaderSession](found) {
		if err := endSession(app, s); err != nil {
			return err
		}
	}
	return nil
}
