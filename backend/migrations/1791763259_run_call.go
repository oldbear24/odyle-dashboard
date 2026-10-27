package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Run now: room_runs.called marks a run a member called the party to, starting a few minutes
// later; the members it invited are its `invited`. A room calls at most once every 30 minutes.
func init() {
	register("1791763259_run_call.go", func(app core.App) error {
		runs, err := app.FindCollectionByNameOrId("room_runs")
		if err != nil {
			return err
		}
		runs.Fields.Add(field(&core.BoolField{}, m{"name": "called"}))
		return app.Save(runs)
	}, func(app core.App) error {
		return removeFields(app, "room_runs", "called")
	})
}
