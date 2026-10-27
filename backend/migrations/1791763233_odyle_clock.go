package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The Odyle clock: the natural pool's regeneration rules as a server-wide setting (the UTC
// hours of its ticks, the Odyle per tick, the pool's caps and a switch that hides every
// estimate), and on each character what its own readings showed: the size of its last
// regeneration tick and the fullest natural pool of the last 30 days, from which clients
// infer its cap. Nothing here is typed by a player.
func init() {
	register("1791763233_odyle_clock.go", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "clock", "maxSize": 2000}))
		if err := app.Save(settings); err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(
			field(&core.NumberField{}, m{"name": "regenTick", "min": 0, "max": 1000, "onlyInt": true}),
			field(&core.NumberField{}, m{"name": "naturalMax", "min": 0, "max": 1000000, "onlyInt": true}),
			field(&core.DateField{}, m{"name": "naturalMaxAt"}),
		)
		return app.Save(characters)
	}, func(app core.App) error {
		if err := removeFields(app, "characters", "regenTick", "naturalMax", "naturalMaxAt"); err != nil {
			return err
		}
		return removeFields(app, "odyle_settings", "clock")
	})
}
