package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Characters without Odyle yet (odyle-windows#6): the Windows app read a complete snapshot of
// the character without its Odyle record, which the game adds at level 22, and said so
// (POST /api/odyle/no-odyle). Rooms then show why the character has no value instead of
// waiting for one; its first verified reading clears the mark.
func init() {
	register("1791763244_odyle_locked.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.BoolField{}, m{"name": "odyleLocked"}))
		return app.Save(characters)
	}, func(app core.App) error {
		return removeFields(app, "characters", "odyleLocked")
	})
}
