package migrations

import "github.com/pocketbase/pocketbase/core"

// Class icons (backend/odyle/classes.go): each class id keeps the file name of its emblem from
// PLAYNC's character pages (class_icon_chanter.png), kept with the armory's images, so the
// dashboard shows it beside a character's class. Empty until the server has downloaded it.
func init() {
	register("1791763264_class_icons.go", func(app core.App) error {
		classes, err := app.FindCollectionByNameOrId("game_classes")
		if err != nil {
			return err
		}
		classes.Fields.Add(field(&core.TextField{}, m{"name": "icon", "max": 100}))
		return app.Save(classes)
	}, func(app core.App) error {
		return removeFields(app, "game_classes", "icon")
	})
}
