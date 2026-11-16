package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// A reader session's last contact (a heartbeat or a reading) gets a field of its own. The
// heartbeats wrote it into PocketBase's updated date until now, so every other change to a
// session moved it too; open sessions take that date over.
func init() {
	register("1791763274_session_contact.go", func(app core.App) error {
		sessions, err := app.FindCollectionByNameOrId("publisher_sessions")
		if err != nil {
			return err
		}
		sessions.Fields.Add(field(&core.DateField{}, m{"name": "lastContactAt"}))
		if err := app.Save(sessions); err != nil {
			return err
		}
		_, err = app.DB().NewQuery("UPDATE publisher_sessions SET lastContactAt = updated").Execute()
		return err
	}, func(app core.App) error {
		if _, err := app.DB().NewQuery("UPDATE publisher_sessions SET updated = lastContactAt WHERE lastContactAt > updated").Execute(); err != nil {
			return err
		}
		return removeFields(app, "publisher_sessions", "lastContactAt")
	})
}
