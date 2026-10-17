package migrations

import "github.com/pocketbase/pocketbase/core"

// Runs outside Odyle (#35): room_runs.link (the run's event elsewhere), and the private calendar
// feed of each account: users.calendarDigest (the digest of its address's token, hidden) and
// users.calendarSince (when that address was made, hidden).
func init() {
	register("1791763254_calendar_feed.go", func(app core.App) error {
		runs, err := app.FindCollectionByNameOrId("room_runs")
		if err != nil {
			return err
		}
		runs.Fields.Add(field(&core.TextField{}, m{"name": "link", "max": 300}))
		if err := app.Save(runs); err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.TextField{}, m{"name": "calendarDigest", "max": 64, "hidden": true}))
		users.Fields.Add(field(&core.TextField{}, m{"name": "calendarSince", "max": 40, "hidden": true}))
		return app.Save(users)
	}, func(app core.App) error {
		if err := removeFields(app, "users", "calendarDigest", "calendarSince"); err != nil {
			return err
		}
		return removeFields(app, "room_runs", "link")
	})
}
