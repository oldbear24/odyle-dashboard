package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Odyle history: one record each time a character's value changes (the first reading
// included), so owners and the rooms a character is shared in can see how it moved.
// Records older than 30 days are deleted by the expiry job and deleting the character
// deletes them. No API rules: GET /api/odyle/history/{id}.
func init() {
	register("1791763214_odyle_history.js", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		return app.Save(collection(m{"name": "character_readings", "type": "base", "fields": fields(
			m{"name": "character", "type": "relation", "collectionId": characters.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "value", "type": "number", "min": 0, "max": 1000000, "onlyInt": true},
			m{"name": "created", "type": "autodate", "onCreate": true},
		), "indexes": []string{"CREATE INDEX idx_character_readings ON character_readings (character, created)", "CREATE INDEX idx_character_readings_created ON character_readings (created)"}}))
	}, func(app core.App) error {
		return deleteCollections(app, "character_readings")
	})
}
