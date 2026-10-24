package migrations

import "github.com/pocketbase/pocketbase/core"

// Slot machine rules (#107): odyle_settings.slots is { dailySpins, perCharacter }, the free spins
// every account has each day and the spins each character read earns, kept under Game settings.
// Empty until a superuser saves it: the backend's defaults (3 and 1) apply until then.
func init() {
	register("1791763260_slot_rules.go", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "slots", "maxSize": 2000}))
		return app.Save(settings)
	}, func(app core.App) error {
		return removeFields(app, "odyle_settings", "slots")
	})
}
