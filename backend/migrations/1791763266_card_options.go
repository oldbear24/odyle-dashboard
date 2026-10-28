package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Card options (backend/odyle/cards.go): a player card's layout, back design, the stats and
// skills it shows and the line under the class, as its player chose them.
func init() {
	register("1791763266_card_options.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.JSONField{}, m{"name": "cardOptions", "maxSize": 2000}))
		return app.Save(characters)
	}, func(app core.App) error {
		return removeFields(app, "characters", "cardOptions")
	})
}
