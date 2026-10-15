package migrations

import "github.com/pocketbase/pocketbase/core"

// Paired PCs carry the Windows computer name the app sends, so Account & data can list
// them and remove one. A reader session remembers the pairing it was opened with:
// removing the PC ends its sessions, and the app learns at its next heartbeat.
func init() {
	register("1791763219_device_names.js", func(app core.App) error {
		devices, err := app.FindCollectionByNameOrId("desktop_devices")
		if err != nil {
			return err
		}
		devices.Fields.Add(field(&core.TextField{}, m{"name": "name", "max": 40}))
		if err := app.Save(devices); err != nil {
			return err
		}
		sessions, err := app.FindCollectionByNameOrId("publisher_sessions")
		if err != nil {
			return err
		}
		sessions.Fields.Add(field(&core.RelationField{}, m{"name": "device", "collectionId": devices.Id, "maxSelect": 1, "cascadeDelete": false}))
		return app.Save(sessions)
	}, func(app core.App) error {
		if err := removeFields(app, "publisher_sessions", "device"); err != nil {
			return err
		}
		return removeFields(app, "desktop_devices", "name")
	})
}
