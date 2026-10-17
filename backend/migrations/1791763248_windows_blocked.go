package migrations

import "github.com/pocketbase/pocketbase/core"

// Held-back Windows versions (odyle-windows#19): odyle_settings.windowsBlocked lists versions
// apps never install and move off when they run one (Server controls → Windows app updates).
func init() {
	register("1791763248_windows_blocked.go", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "windowsBlocked", "maxSize": 2000}))
		return app.Save(settings)
	}, func(app core.App) error {
		return removeFields(app, "odyle_settings", "windowsBlocked")
	})
}
