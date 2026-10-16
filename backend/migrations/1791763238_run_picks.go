package migrations

import "github.com/pocketbase/pocketbase/core"

// The character each attendee brings to a planned run (backend/odyle/accounts.go plan):
// picks maps a membership to one of its own characters shared in the room. Rooms list it by
// account id as `picks`; `attendees` stays the list of account ids the Windows app reads.
func init() {
	register("1791763238_run_picks.go", func(app core.App) error {
		runs, err := app.FindCollectionByNameOrId("room_runs")
		if err != nil {
			return err
		}
		runs.Fields.Add(field(&core.JSONField{}, m{"name": "picks", "maxSize": 10000}))
		return app.Save(runs)
	}, func(app core.App) error {
		return removeFields(app, "room_runs", "picks")
	})
}
