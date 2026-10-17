package migrations

import "github.com/pocketbase/pocketbase/core"

// Readiness in a run's Discord post (#46): a room can choose to show, in each post, how many of
// those going can claim a cube (counts only, never names or values: the channel may include
// people outside the room). discord_posts.claims is what a post last showed, so the reminders
// job edits it only when the count changed.
func init() {
	register("1791763246_discord_readiness.go", func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("party_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.Add(field(&core.BoolField{}, m{"name": "discordReadiness"}))
		if err := app.Save(rooms); err != nil {
			return err
		}
		posts, err := app.FindCollectionByNameOrId("discord_posts")
		if err != nil {
			return err
		}
		posts.Fields.Add(field(&core.TextField{}, m{"name": "claims", "max": 40}))
		return app.Save(posts)
	}, func(app core.App) error {
		if err := removeFields(app, "discord_posts", "claims"); err != nil {
			return err
		}
		return removeFields(app, "party_rooms", "discordReadiness")
	})
}
