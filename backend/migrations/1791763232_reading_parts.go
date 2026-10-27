package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The game's two numbers of a reading (its natural pool and what items added) on the
// character and on each history point, and what the change was (regen, spend, item,
// snapshot or update) with the change of the total. Windows apps from before send none of
// it; their readings keep the total only.
func init() {
	register("1791763232_reading_parts.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.JSONField{}, m{"name": "parts", "maxSize": 200}))
		if err := app.Save(characters); err != nil {
			return err
		}
		readings, err := app.FindCollectionByNameOrId("character_readings")
		if err != nil {
			return err
		}
		readings.Fields.Add(
			field(&core.JSONField{}, m{"name": "parts", "maxSize": 200}),
			field(&core.TextField{}, m{"name": "kind", "max": 10}),
			field(&core.NumberField{}, m{"name": "delta", "min": -1000000, "max": 1000000, "onlyInt": true}),
		)
		return app.Save(readings)
	}, func(app core.App) error {
		if err := removeFields(app, "character_readings", "parts", "kind", "delta"); err != nil {
			return err
		}
		return removeFields(app, "characters", "parts")
	})
}
