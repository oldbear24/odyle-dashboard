package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Wishlist invites (#45): room_runs.invited lists the memberships a run planned from the
// wishlist invited, those who wanted its dungeon; attendees stay those going.
func init() {
	register("1791763253_run_invited.go", func(app core.App) error {
		runs, err := app.FindCollectionByNameOrId("room_runs")
		if err != nil {
			return err
		}
		runs.Fields.Add(field(&core.JSONField{}, m{"name": "invited", "maxSize": 4000}))
		return app.Save(runs)
	}, func(app core.App) error {
		return removeFields(app, "room_runs", "invited")
	})
}
