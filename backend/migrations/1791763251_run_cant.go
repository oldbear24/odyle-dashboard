package migrations

import "github.com/pocketbase/pocketbase/core"

// Can't (#45): room_runs.cant lists the memberships that answered they cannot come to a run;
// attendees stay those going, as installed Windows apps read them.
func init() {
	register("1791763251_run_cant.go", func(app core.App) error {
		runs, err := app.FindCollectionByNameOrId("room_runs")
		if err != nil {
			return err
		}
		runs.Fields.Add(field(&core.JSONField{}, m{"name": "cant", "maxSize": 4000}))
		return app.Save(runs)
	}, func(app core.App) error {
		return removeFields(app, "room_runs", "cant")
	})
}
