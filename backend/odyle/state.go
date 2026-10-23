package odyle

import (
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// state is what the backend keeps in server memory only: the settings, the newest
// packets, the last hour's traffic, the background jobs' records, the cached Windows
// release and backup list, the armory's queue and searches, and what kept the environment's backup and proxy settings
// from applying. A restart clears it.
type state struct {
	mu        sync.Mutex
	startedAt string
	root      core.App // the app Register was given, never a transaction

	changes   *outbox        // realtime news, delivered at once
	sightings *outbox        // heartbeats for realtime, delivered every two seconds
	presence  *presence      // heartbeats not written yet
	health    *health        // what each reader last reported (health.go)
	pushes    sync.WaitGroup // Run now pushes on their way (inviteToRun)

	settings settingsCache // has its own lock

	packetCount int64
	packets     []*object // the newest 200, oldest first
	traffic     *traffic  // has its own lock

	jobs    map[string]*jobRecord // the runs of each job
	running map[string]time.Time  // jobs running now, since

	vacuums   map[string]*vacuumRecord // the last vacuum of each database (vacuum.go)
	vacuuming string                   // the database a vacuum runs on now

	portraits *portraitWork // has its own lock

	armory       *armoryWork     // has its own lock
	armorySearch *armorySearches // has its own lock

	webhooks webhookWaits // has its own lock

	backups     backupList // has its own lock
	backupSetup string     // why ODYLE_BACKUP_S3_* did not apply (backups.go)
	proxySetup  string     // why ODYLE_TRUSTED_PROXY_* did not apply (proxy.go)

	releaseAt        time.Time // the last lookup
	release          map[string]any
	releaseETag      string // of release, for asking GitHub whether it changed
	releaseChecked   bool
	releaseFetchedAt time.Time     // GitHub's last answer
	releaseError     string        // why the last lookup failed
	releaseNotBefore time.Time     // GitHub's rate limit allows no lookup before then
	releaseInFlight  chan struct{} // closed when the running lookup is done; nil while none runs
}

func stateOf(app core.App) *state {
	return app.Store().GetOrSet("odyle.state", func() any {
		return &state{traffic: newTraffic(), jobs: map[string]*jobRecord{}, running: map[string]time.Time{}, vacuums: map[string]*vacuumRecord{}, portraits: newPortraitWork(), armory: newArmoryWork(), armorySearch: newArmorySearches(),
			changes: newOutbox(changesDelay), sightings: newOutbox(presenceDelay), presence: newPresence(), health: newHealth()}
	}).(*state)
}
