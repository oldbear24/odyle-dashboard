package migrations

import "github.com/pocketbase/pocketbase/core"

// Server-wide game rules. Only superusers can edit them, in the PocketBase dashboard
// (Collections → odyle_settings); rooms no longer set their own cost.
func init() {
	register("1791763205_odyle_settings.js", func(app core.App) error {
		settings := collection(m{"name": "odyle_settings", "type": "base", "fields": fields(
			m{"name": "odylePerCube", "type": "number", "min": 1, "max": 1000, "onlyInt": true, "required": true},
		)})
		if err := app.Save(settings); err != nil {
			return err
		}
		record := core.NewRecord(settings)
		record.Set("odylePerCube", 40)
		return app.Save(record)
	}, func(app core.App) error {
		return deleteCollections(app, "odyle_settings")
	})
}
