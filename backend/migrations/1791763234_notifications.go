package migrations

import "github.com/pocketbase/pocketbase/core"

// An account's notification settings (backend/odyle/notifications.go): which notifications,
// where and its quiet hours, edited on the dashboard and followed by every client. Empty
// until the account saves them; the defaults apply meanwhile.
func init() {
	register("1791763234_notifications.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.JSONField{}, m{"name": "notifications", "maxSize": 2000}))
		return app.Save(users)
	}, func(app core.App) error {
		return removeFields(app, "users", "notifications")
	})
}
