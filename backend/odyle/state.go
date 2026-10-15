package odyle

import (
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// state is what the backend keeps in server memory only: the newest packets, the
// background jobs' records and the cached Windows release. A restart clears it.
type state struct {
	mu        sync.Mutex
	startedAt string

	packetCount int64
	packets     []*object // the newest 200, oldest first

	jobs    map[string]map[string]any // the last run of each job
	running map[string]time.Time      // jobs running now, since

	releaseAt      time.Time
	release        map[string]any
	releaseChecked bool
}

func stateOf(app core.App) *state {
	return app.Store().GetOrSet("odyle.state", func() any {
		return &state{jobs: map[string]map[string]any{}, running: map[string]time.Time{}}
	}).(*state)
}
