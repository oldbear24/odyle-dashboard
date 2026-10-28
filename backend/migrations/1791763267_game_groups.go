package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// In-game groups (backend/odyle/groups.go): the ids the game gives the party and the force a
// character is in, as its Windows app last read them, null outside both. No API rules: POST
// /api/odyle/game-group.
func init() {
	register("1791763267_game_groups.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.JSONField{}, m{"name": "gameGroup", "maxSize": 200}))
		return app.Save(characters)
	}, func(app core.App) error {
		return removeFields(app, "characters", "gameGroup")
	})
}
