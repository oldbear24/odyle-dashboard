package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// A Server controls switch that pauses every paired Windows app's packet reader: apps
// learn it from their rooms, session and heartbeat answers, stop capturing and resume
// once it is off; readings sent meanwhile are refused. Off by default.
func init() {
	register("1791763225_reader_pause.go", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.BoolField{}, m{"name": "readerPaused"}))
		return app.Save(settings)
	}, func(app core.App) error {
		return removeFields(app, "odyle_settings", "readerPaused")
	})
}
