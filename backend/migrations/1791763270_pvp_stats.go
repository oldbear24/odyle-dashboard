package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// PvP stats (opt-in, backend/odyle/pvp.go): an account that turns on users.pvpStats lets the
// Windows app send its characters' PvP kills, assists and deaths with the name of the other
// player. Each is a row of character_pvp, kept as long as odyle_settings.pvpDays says (90 days
// unless a superuser sets another period), deleted by the expiry job, with the character, and
// when the owner turns PvP stats off. characters.pvp is the character's count since it was
// turned on (null while it is off), which rooms see with the shared character. No API rules:
// POST /api/odyle/pvp and GET /api/odyle/pvp/{id}.
func init() {
	register("1791763270_pvp_stats.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.BoolField{}, m{"name": "pvpStats"}))
		if err := app.Save(users); err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.JSONField{}, m{"name": "pvp", "maxSize": 300}))
		if err := app.Save(characters); err != nil {
			return err
		}
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.NumberField{}, m{"name": "pvpDays", "min": 0, "max": 3650, "onlyInt": true}))
		if err := app.Save(settings); err != nil {
			return err
		}
		if err := setAll(app, "odyle_settings", m{"pvpDays": 90}); err != nil {
			return err
		}
		return app.Save(collection(m{"name": "character_pvp", "type": "base", "fields": fields(
			m{"name": "character", "type": "relation", "collectionId": characters.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			// The id the app gave the event, so one sent twice is stored once.
			m{"name": "event", "type": "text", "max": 32, "required": true},
			m{"name": "kind", "type": "text", "max": 10, "required": true},
			// The other player: who was killed (kill, assist) or who made the kill (death).
			m{"name": "name", "type": "text", "max": 40, "required": true},
			m{"name": "server", "type": "text", "max": 40},
			m{"name": "region", "type": "text", "max": 20},
			// An assist: who made the kill.
			m{"name": "killer", "type": "text", "max": 40},
			m{"name": "killerServer", "type": "text", "max": 40},
			m{"name": "killerRegion", "type": "text", "max": 20},
			m{"name": "at", "type": "date", "required": true},
			m{"name": "created", "type": "autodate", "onCreate": true},
		), "indexes": []string{"CREATE UNIQUE INDEX idx_character_pvp_event ON character_pvp (character, event)", "CREATE INDEX idx_character_pvp ON character_pvp (character, at)", "CREATE INDEX idx_character_pvp_at ON character_pvp (at)"}}))
	}, func(app core.App) error {
		if err := deleteCollections(app, "character_pvp"); err != nil {
			return err
		}
		if err := removeFields(app, "odyle_settings", "pvpDays"); err != nil {
			return err
		}
		if err := removeFields(app, "characters", "pvp"); err != nil {
			return err
		}
		return removeFields(app, "users", "pvpStats")
	})
}
