package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The main character: a player marks one of their characters as the one they play most
// (POST /api/odyle/main-character), and the dashboard highlights it in the library and in
// every room it is shared in. At most one character of an account has characters.main set.
func init() {
	register("1791763255_main_character.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.BoolField{}, m{"name": "main"}))
		return app.Save(characters)
	}, func(app core.App) error {
		return removeFields(app, "characters", "main")
	})
}
