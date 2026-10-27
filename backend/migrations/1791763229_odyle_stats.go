package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// One row a day of the activation and feature-use totals the Server status page shows
// (backend/odyle/stats.go), written by the nightly odyle-stats job, so their trend
// survives restarts. Totals only: no row names or counts a single account. No API
// rules: superusers only.
func init() {
	register("1791763229_odyle_stats.go", func(app core.App) error {
		totals := []any{}
		for _, name := range []string{"accounts", "activeAccounts", "pairedAccounts", "readingAccounts", "sharingAccounts", "roomsReading", "readings", "roomsWithRuns", "wishlistEntries", "taskAccounts", "discordRooms"} {
			totals = append(totals, m{"name": name, "type": "number", "min": 0, "onlyInt": true})
		}
		return app.Save(collection(m{"name": "odyle_stats", "type": "base", "fields": fields(
			m{"name": "day", "type": "text", "required": true, "max": 10, "pattern": `^\d{4}-\d{2}-\d{2}$`},
			totals,
			m{"name": "appVersions", "type": "json", "maxSize": 20000},
			dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_odyle_stats_day ON odyle_stats (day)"}}))
	}, func(app core.App) error {
		return deleteCollections(app, "odyle_stats")
	})
}
