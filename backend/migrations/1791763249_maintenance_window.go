package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The game's weekly maintenance window (#47): odyle_settings.maintenance is { day, hour, hours }
// (UTC; a day of "" for none), kept under Game settings; planned runs inside it say so.
func init() {
	register("1791763249_maintenance_window.go", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "maintenance", "maxSize": 200}))
		return app.Save(settings)
	}, func(app core.App) error {
		return removeFields(app, "odyle_settings", "maintenance")
	})
}
