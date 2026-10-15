package odyle

import (
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// state is what the backend keeps in server memory only: the newest packets, the last
// hour's traffic, the background jobs' records and the cached Windows release. A restart
// clears it.
type state struct {
	mu        sync.Mutex
	startedAt string

	packetCount int64
	packets     []*object // the newest 200, oldest first
	traffic     *traffic  // has its own lock

	jobs    map[string]map[string]any // the last run of each job
	running map[string]time.Time      // jobs running now, since

	releaseAt        time.Time // the last lookup
	release          map[string]any
	releaseChecked   bool
	releaseFetchedAt time.Time // GitHub's last answer
	releaseError     string    // why the last lookup failed
}

func stateOf(app core.App) *state {
	return app.Store().GetOrSet("odyle.state", func() any {
		return &state{traffic: newTraffic(), jobs: map[string]map[string]any{}, running: map[string]time.Time{}}
	}).(*state)
}
