package migrations

import "github.com/pocketbase/pocketbase/core"

// Party ready (#48): room_runs.readyFor is the start time whose attendees were told that
// everyone going can claim a cube, so each start time is told once.
func init() {
	register("1791763250_party_ready.go", func(app core.App) error {
		runs, err := app.FindCollectionByNameOrId("room_runs")
		if err != nil {
			return err
		}
		runs.Fields.Add(field(&core.TextField{}, m{"name": "readyFor", "max": 40, "hidden": true}))
		return app.Save(runs)
	}, func(app core.App) error {
		return removeFields(app, "room_runs", "readyFor")
	})
}
