package migrations

import "github.com/pocketbase/pocketbase/core"

// The membership answer (backend/odyle/membership.go): an account says whether its game account
// has the membership ("yes", "no", or "" while not sure), and each of its characters carries the
// natural pool's cap that answer settles for the Odyle clock (answeredCap, 0 while open). Rooms
// see the cap with the shared character, never the account's answer. Nothing read from the game
// changes.
func init() {
	register("1791763240_membership.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.TextField{}, m{"name": "membership", "max": 3}))
		if err := app.Save(users); err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.NumberField{}, m{"name": "answeredCap", "min": 0, "max": 1000000, "onlyInt": true}))
		return app.Save(characters)
	}, func(app core.App) error {
		if err := removeFields(app, "characters", "answeredCap"); err != nil {
			return err
		}
		return removeFields(app, "users", "membership")
	})
}
