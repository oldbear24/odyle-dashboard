package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Player cards (backend/odyle/cards.go): the card design and holo finish a player chose for
// the armory profile of one of their characters, and an index for finding a profile's
// characters by PLAYNC's id.
func init() {
	register("1791763265_player_cards.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.TextField{}, m{"name": "cardDesign", "max": 20}))
		characters.Fields.Add(field(&core.TextField{}, m{"name": "cardFinish", "max": 20}))
		characters.AddIndex("idx_characters_official", false, "`officialId`", "")
		return app.Save(characters)
	}, func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.RemoveIndex("idx_characters_official")
		if err := app.Save(characters); err != nil {
			return err
		}
		return removeFields(app, "characters", "cardDesign", "cardFinish")
	})
}
