package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// An optional list of dungeon names superusers keep on the dashboard's Odyle page.
// While it is empty, wishlists and planned runs take any name; once it lists dungeons,
// new entries must be one of them and take its spelling.
func init() {
	register("1791763216_dungeon_catalog.js", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "dungeons", "maxSize": 20000}))
		if err := app.Save(settings); err != nil {
			return err
		}
		return setAll(app, "odyle_settings", m{"dungeons": []any{}})
	}, func(app core.App) error {
		return removeFields(app, "odyle_settings", "dungeons")
	})
}
