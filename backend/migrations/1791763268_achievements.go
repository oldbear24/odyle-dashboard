package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Achievements (backend/odyle/achievements.go): users.achievements keeps the account's own
// counts (cubes' worth of Odyle spent, days the reader read, friends who joined with its
// links, runs planned…), when each achievement was reached and when the account last looked.
// Hidden: only the achievements route and the account's export answer it.
func init() {
	register("1791763268_achievements.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.JSONField{}, m{"name": "achievements", "maxSize": 8000, "hidden": true}))
		return app.Save(users)
	}, func(app core.App) error {
		return removeFields(app, "users", "achievements")
	})
}
