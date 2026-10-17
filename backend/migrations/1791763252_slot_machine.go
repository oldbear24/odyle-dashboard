package migrations

import "github.com/pocketbase/pocketbase/core"

// The slot machine (#107): users.spins (whole spins to use) and users.cosmetics (owned and
// equipped items, shards, whether the welcome spins were given), and characters.spinDay (the
// daily period whose spin the character already earned). All hidden: only the slot routes and
// room snapshots (the equipped look) answer them.
func init() {
	register("1791763252_slot_machine.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.NumberField{}, m{"name": "spins", "onlyInt": true, "min": 0, "hidden": true}))
		users.Fields.Add(field(&core.JSONField{}, m{"name": "cosmetics", "maxSize": 8000, "hidden": true}))
		if err := app.Save(users); err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.TextField{}, m{"name": "spinDay", "max": 10, "hidden": true}))
		return app.Save(characters)
	}, func(app core.App) error {
		if err := removeFields(app, "characters", "spinDay"); err != nil {
			return err
		}
		return removeFields(app, "users", "spins", "cosmetics")
	})
}
