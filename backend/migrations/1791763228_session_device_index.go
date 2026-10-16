package migrations

import "github.com/pocketbase/pocketbase/core"

// Reader sessions are looked up by their paired PC when a session starts and when a PC
// is removed; 1791763219 added the column without an index.
func init() {
	register("1791763228_session_device_index.go", func(app core.App) error {
		sessions, err := app.FindCollectionByNameOrId("publisher_sessions")
		if err != nil {
			return err
		}
		sessions.AddIndex("idx_publisher_sessions_device", false, "`device`", "")
		return app.Save(sessions)
	}, func(app core.App) error {
		sessions, err := app.FindCollectionByNameOrId("publisher_sessions")
		if err != nil {
			return err
		}
		sessions.RemoveIndex("idx_publisher_sessions_device")
		return app.Save(sessions)
	})
}
