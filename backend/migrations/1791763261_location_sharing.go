package migrations

import "github.com/pocketbase/pocketbase/core"

// Location sharing (opt-in): an account that turns on users.shareLocation lets the Windows app
// send where its characters are, as the game says on each map load, arrival and flight. The
// latest place is characters.location (null while the owner does not share), which rooms see
// with the shared character; every place is kept for 30 days in character_locations, deleted
// by the expiry job, with the character, and when the owner stops sharing. No API rules:
// POST /api/odyle/location and GET /api/odyle/locations/{id}. odyle_settings.maps names the
// game's map ids and links each to a TH.GL map (superusers, Game settings).
func init() {
	register("1791763261_location_sharing.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.BoolField{}, m{"name": "shareLocation"}))
		if err := app.Save(users); err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.JSONField{}, m{"name": "location", "maxSize": 2000}))
		if err := app.Save(characters); err != nil {
			return err
		}
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "maps", "maxSize": 60000}))
		if err := app.Save(settings); err != nil {
			return err
		}
		return app.Save(collection(m{"name": "character_locations", "type": "base", "fields": fields(
			m{"name": "character", "type": "relation", "collectionId": characters.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "map", "type": "number", "min": 1, "max": 9999999, "onlyInt": true, "required": true},
			m{"name": "x", "type": "number", "min": -1000000, "max": 1000000},
			m{"name": "y", "type": "number", "min": -1000000, "max": 1000000},
			m{"name": "z", "type": "number", "min": -1000000, "max": 1000000},
			m{"name": "heading", "type": "json", "maxSize": 50},
			m{"name": "source", "type": "text", "max": 10},
			m{"name": "created", "type": "autodate", "onCreate": true},
		), "indexes": []string{"CREATE INDEX idx_character_locations ON character_locations (character, created)", "CREATE INDEX idx_character_locations_created ON character_locations (created)"}}))
	}, func(app core.App) error {
		if err := deleteCollections(app, "character_locations"); err != nil {
			return err
		}
		if err := removeFields(app, "odyle_settings", "maps"); err != nil {
			return err
		}
		if err := removeFields(app, "characters", "location"); err != nil {
			return err
		}
		return removeFields(app, "users", "shareLocation")
	})
}
