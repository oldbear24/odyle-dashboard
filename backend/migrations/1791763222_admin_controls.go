package migrations

import "github.com/pocketbase/pocketbase/core"

// Server controls of the superuser dashboard's Odyle page: an announcement the
// dashboard and the Windows app show, switches that pause portrait refresh, Discord
// reminders and new pairings, and packet adapters accepted beside (or instead of) the
// built-in ones.
func init() {
	register("1791763222_admin_controls.js", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.TextField{}, m{"name": "announcement", "max": 300}))
		settings.Fields.Add(field(&core.TextField{}, m{"name": "announcementLevel", "max": 10}))
		for _, name := range []string{"portraitsPaused", "remindersPaused", "pairingPaused"} {
			settings.Fields.Add(field(&core.BoolField{}, m{"name": name}))
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "adapters", "maxSize": 5000}))
		if err := app.Save(settings); err != nil {
			return err
		}
		if err := setAll(app, "odyle_settings", m{"announcementLevel": "info", "adapters": m{"extra": []any{}, "disabled": []any{}}}); err != nil {
			return err
		}
		// A reader session remembers the Windows app version that opened it, for the Apps page.
		sessions, err := app.FindCollectionByNameOrId("publisher_sessions")
		if err != nil {
			return err
		}
		sessions.Fields.Add(field(&core.TextField{}, m{"name": "appVersion", "max": 20}))
		return app.Save(sessions)
	}, func(app core.App) error {
		if err := removeFields(app, "publisher_sessions", "appVersion"); err != nil {
			return err
		}
		return removeFields(app, "odyle_settings", "announcement", "announcementLevel", "portraitsPaused", "remindersPaused", "pairingPaused", "adapters")
	})
}
