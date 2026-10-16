package migrations

import "github.com/pocketbase/pocketbase/core"

// How many portrait lookups in a row the official search did not list the character,
// so the portrait job waits longer before each new try (odyle/portraits.go). Hidden
// like the job's other fields; a portrait found sets it back to 0.
func init() {
	register("1791763225_portrait_backoff.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.NumberField{}, m{"name": "portraitMisses", "min": 0, "onlyInt": true, "hidden": true}))
		return app.Save(characters)
	}, func(app core.App) error {
		return removeFields(app, "characters", "portraitMisses")
	})
}
