package odyle

import (
	"log/slog"
	"os"

	"github.com/pocketbase/pocketbase/core"
)

// Odyle's own log lines: failed jobs, failed lookups at PLAYNC, Discord and GitHub, and
// deleted inactive accounts, each with its fields (job, character, room, error, …).
// They go to the standard error as text, and to PocketBase's logs, which show them
// under Logs in the superuser dashboard once Settings → Logs keeps logs at all (the
// first migration keeps none, request logs included). In --dev mode PocketBase prints
// its logs itself, so they are not written twice.
var stderrLog = slog.NewTextHandler(os.Stderr, nil)

func logger(app core.App) *slog.Logger {
	if app == nil {
		return slog.New(stderrLog)
	}
	if app.IsDev() {
		return app.Logger()
	}
	return slog.New(slog.NewMultiHandler(stderrLog, app.Logger().Handler()))
}

func warn(app core.App, msg string, args ...any) { logger(app).Warn(msg, args...) }

func info(app core.App, msg string, args ...any) { logger(app).Info(msg, args...) }
