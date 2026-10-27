package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Discord reminders that link back, update in place and report delivery (#33), and opt-in
// pings (#34, a notification channel, no field). Rooms choose up to three lead times
// (discordLeads, minutes; empty: 15) and a post when a run starts (discordStartPost), and keep
// the webhook's name in Discord (discordName) and how its last delivery went (discordStatus).
// discord_posts keeps each reminder Discord took, with its message id, so the backend edits
// it after a change and marks it when the run is cancelled or done (backend/odyle/discord.go);
// rows go two days after their post. Only the backend reads them.
func init() {
	register("1791763242_discord_posts.go", func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("party_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.Add(
			field(&core.JSONField{}, m{"name": "discordLeads", "maxSize": 200}),
			field(&core.BoolField{}, m{"name": "discordStartPost"}),
			field(&core.TextField{}, m{"name": "discordName", "max": 100}),
			field(&core.JSONField{}, m{"name": "discordStatus", "maxSize": 2000}),
		)
		if err := app.Save(rooms); err != nil {
			return err
		}
		posts := collection(m{"name": "discord_posts", "type": "base", "fields": fields(
			m{"name": "room", "type": "relation", "collectionId": rooms.Id, "cascadeDelete": true, "maxSelect": 1, "required": true},
			m{"name": "run", "type": "text", "required": true, "max": 30},
			m{"name": "webhook", "type": "text", "max": 100},
			m{"name": "messageId", "type": "text", "max": 30},
			m{"name": "lead", "type": "number", "onlyInt": true, "min": 0, "max": 1440},
			m{"name": "startsAt", "type": "date"},
			m{"name": "dungeon", "type": "text", "max": 200},
			m{"name": "postedAt", "type": "date"},
			m{"name": "dirty", "type": "bool"},
			m{"name": "ended", "type": "text", "max": 20},
			dates(),
		), "indexes": []string{"CREATE INDEX idx_discord_posts_run ON discord_posts (run)", "CREATE INDEX idx_discord_posts_dirty ON discord_posts (dirty, postedAt)"}})
		return app.Save(posts)
	}, func(app core.App) error {
		if err := deleteCollections(app, "discord_posts"); err != nil {
			return err
		}
		return removeFields(app, "party_rooms", "discordLeads", "discordStartPost", "discordName", "discordStatus")
	})
}
