package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Database vacuum, started by hand from Server status: SQLite keeps the pages that deleted
// rows freed (expired sessions, old history, deleted accounts) inside its file, and VACUUM
// rewrites the file without them. A write-ahead log checkpoint afterwards hands the space
// back to the disk. While it runs every write to that database waits, so it only runs by
// hand, one at a time. The last run of each database lives in server memory only.
var databases = map[string]struct {
	file   string
	db     func(core.App) dbx.Builder
	vacuum func(core.App) error
}{
	"data": {file: "data.db", db: core.App.NonconcurrentDB, vacuum: core.App.Vacuum},
	"logs": {file: "auxiliary.db", db: core.App.AuxNonconcurrentDB, vacuum: core.App.AuxVacuum},
}

// vacuumRecord is a database's last vacuum since the server started.
type vacuumRecord struct {
	At          string `json:"at"`
	Ms          int64  `json:"ms"`
	BeforeBytes int64  `json:"beforeBytes"`
	AfterBytes  int64  `json:"afterBytes"`
	Error       string `json:"error,omitempty"`
}

// freeBytes is the space the database's free pages take, what a vacuum can give back.
func freeBytes(app core.App, name string) int64 {
	var pages, size int64
	db := databases[name].db(app)
	if db.NewQuery("PRAGMA freelist_count").Row(&pages) != nil || db.NewQuery("PRAGMA page_size").Row(&size) != nil {
		return 0
	}
	return pages * size
}

// databaseStatus is the database part of Server status: each file's size with its log, its
// free space, its last vacuum and whether one runs now.
func databaseStatus(app core.App) *object {
	s := stateOf(app)
	s.mu.Lock()
	running, last := s.vacuuming, map[string]*vacuumRecord{}
	for name, record := range s.vacuums {
		copied := *record
		last[name] = &copied
	}
	s.mu.Unlock()
	out := newObject().
		set("dataBytes", size(app, "data.db", "data.db-wal")).set("dataFreeBytes", freeBytes(app, "data")).
		set("logsBytes", size(app, "auxiliary.db", "auxiliary.db-wal")).set("logsFreeBytes", freeBytes(app, "logs")).
		set("vacuuming", running)
	vacuums := newObject()
	for _, name := range []string{"data", "logs"} {
		if last[name] != nil {
			vacuums.set(name, last[name])
		}
	}
	return out.set("vacuums", vacuums)
}

// vacuum rewrites one database; false when another vacuum runs.
func vacuum(app core.App, name string) (*vacuumRecord, bool) {
	d, s := databases[name], stateOf(app)
	s.mu.Lock()
	if s.vacuuming != "" {
		s.mu.Unlock()
		return nil, false
	}
	s.vacuuming = name
	s.mu.Unlock()

	record := &vacuumRecord{BeforeBytes: size(app, d.file, d.file+"-wal")}
	started := time.Now()
	err := d.vacuum(app)
	if err == nil {
		_, err = d.db(app).NewQuery("PRAGMA wal_checkpoint(TRUNCATE)").Execute()
	}
	record.At, record.Ms, record.AfterBytes = now(), time.Since(started).Milliseconds(), size(app, d.file, d.file+"-wal")
	if err != nil {
		record.Error = message(err)
		warn(app, "Odyle vacuum failed", "database", d.file, "error", record.Error)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.vacuuming = ""
	s.vacuums[name] = record
	return record, true
}

func vacuumRoute(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if _, ok := databases[name]; !ok {
		return notFound("There is no such database.")
	}
	record, ok := vacuum(e.App, name)
	if !ok {
		return badRequest("A vacuum is running right now. Try again in a moment.")
	}
	return e.JSON(200, map[string]any{"result": record, "database": databaseStatus(e.App)})
}
