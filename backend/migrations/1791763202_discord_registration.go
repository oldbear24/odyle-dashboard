package migrations

import "github.com/pocketbase/pocketbase/core"

// PocketBase creates first-time OAuth accounts through its record-create handler,
// which applies createRule with this server-assigned context.
func init() {
	register("1791763202_discord_registration.js", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		rule := `@request.context = "oauth2"`
		users.CreateRule = &rule
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.CreateRule = nil
		return app.Save(users)
	})
}
