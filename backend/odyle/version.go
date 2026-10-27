package odyle

import (
	"net/http/pprof"
	"runtime"
	"runtime/debug"
	runtimepprof "runtime/pprof"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Version is the release the backend was built as and Commit its commit. The release
// workflow and the image set both (go build -ldflags "-X
// github.com/oldbear24/odyle-dashboard/backend/odyle.Version=0.6.0 -X ….Commit=<sha>");
// a build from a git checkout names its commit anyway (Go records it), and an unnamed
// build reads "dev".
var Version, Commit = "", ""

type buildInfo struct {
	Version    string `json:"version"`
	Commit     string `json:"commit"`
	Modified   bool   `json:"modified"` // built from a checkout with uncommitted changes
	BuiltAt    string `json:"builtAt"`  // the commit's time
	Go         string `json:"go"`
	PocketBase string `json:"pocketbase"`
	Platform   string `json:"platform"`
}

var build = sync.OnceValue(func() buildInfo {
	b := buildInfo{Version: Version, Go: runtime.Version(), Platform: runtime.GOOS + "/" + runtime.GOARCH}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			switch s.Key {
			case "vcs.revision":
				b.Commit = s.Value
			case "vcs.time":
				b.BuiltAt = s.Value
			case "vcs.modified":
				b.Modified = s.Value == "true"
			}
		}
		for _, dep := range info.Deps {
			if dep.Path == "ganigeorgiev.com/pocketbase/pocketbase" {
				b.PocketBase = dep.Version
			}
		}
	}
	if b.Version == "" {
		b.Version = "dev"
	}
	if b.Commit == "" {
		b.Commit = Commit
	}
	return b
})

// runtimeStatus is the Go runtime as the Server status page shows it: goroutines, memory,
// garbage collection, processors and realtime connections.
func runtimeStatus(app core.App) *object {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	lastPause := time.Duration(0)
	if m.NumGC > 0 {
		lastPause = time.Duration(m.PauseNs[(m.NumGC+255)%256])
	}
	ms := func(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
	return newObject().set("goroutines", runtime.NumGoroutine()).
		set("heapBytes", m.HeapAlloc).set("heapObjects", m.HeapObjects).set("systemBytes", m.Sys).
		set("gcCycles", m.NumGC).set("lastPauseMs", ms(lastPause)).set("pauseTotalMs", ms(time.Duration(m.PauseTotalNs))).
		set("cpus", runtime.NumCPU()).set("maxProcs", runtime.GOMAXPROCS(0)).
		set("realtimeClients", app.SubscriptionsBroker().TotalClients())
}

// pprofRoute serves Go's runtime profiles to superusers: GET
// /api/odyle/admin/pprof/profile?seconds=30 (CPU), trace?seconds=5, and heap, allocs,
// goroutine, threadcreate, block and mutex (the last two stay empty: their sampling is off).
// Fetch one with the superuser token and read it with go tool pprof.
func pprofRoute(e *core.RequestEvent) error {
	switch name := e.Request.PathValue("name"); name {
	case "profile":
		pprof.Profile(e.Response, e.Request)
	case "trace":
		pprof.Trace(e.Response, e.Request)
	default:
		if runtimepprof.Lookup(name) == nil {
			return apis.NewNotFoundError("Unknown profile.", nil)
		}
		pprof.Handler(name).ServeHTTP(e.Response, e.Request)
	}
	return nil
}
