package migrations

import "github.com/pocketbase/pocketbase/core"

// How long the history is kept, set by superusers under Game settings: odyle_settings.historyDays
// is how many days each change of a character's Odyle stays in character_readings, and
// locationDays how many days each place stays in character_locations, 1 to 3650 each. Both
// were 30 days; existing settings keep that.
func init() {
	register("1791763262_kept_days.go", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.NumberField{}, m{"name": "historyDays", "min": 0, "max": 3650, "onlyInt": true}))
		settings.Fields.Add(field(&core.NumberField{}, m{"name": "locationDays", "min": 0, "max": 3650, "onlyInt": true}))
		if err := app.Save(settings); err != nil {
			return err
		}
		return setAll(app, "odyle_settings", m{"historyDays": 30, "locationDays": 30})
	}, func(app core.App) error {
		return removeFields(app, "odyle_settings", "historyDays", "locationDays")
	})
}
