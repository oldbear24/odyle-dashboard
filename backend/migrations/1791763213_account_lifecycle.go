package migrations

import (
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Accounts can now be deleted by their owner and, when a superuser sets
// inactiveAccountDays, after that many days without using the dashboard or the Windows
// app. lastActiveAt is the last time the account used an Odyle route (written at most
// hourly); existing accounts count as active from this upgrade.
func init() {
	register("1791763213_account_lifecycle.js", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.DateField{}, m{"name": "lastActiveAt"}))
		users.AddIndex("idx_users_last_active", false, "`lastActiveAt`", "")
		if err := app.Save(users); err != nil {
			return err
		}
		if err := setAll(app, "users", m{"lastActiveAt": time.Now().UTC().Format("2006-01-02 15:04:05.000Z")}); err != nil {
			return err
		}
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.NumberField{}, m{"name": "inactiveAccountDays", "min": 0, "max": 3650, "onlyInt": true}))
		if err := app.Save(settings); err != nil {
			return err
		}
		return setAll(app, "odyle_settings", m{"inactiveAccountDays": 0})
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.RemoveIndex("idx_users_last_active")
		users.Fields.RemoveByName("lastActiveAt")
		if err := app.Save(users); err != nil {
			return err
		}
		return removeFields(app, "odyle_settings", "inactiveAccountDays")
	})
}
