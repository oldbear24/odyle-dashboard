package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Discord reminders of planned runs. A room owner may connect a channel webhook; the
// backend posts each run there 15 minutes before it starts. The URL is a secret, so the
// field is hidden: no API response or snapshot carries it. remindedAt marks the run as
// announced, and a new start time clears it.
func init() {
	register("1791763220_run_reminders.js", func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("party_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.Add(field(&core.TextField{}, m{"name": "discordWebhook", "max": 300, "hidden": true}))
		rooms.Fields.Add(field(&core.SelectField{}, m{"name": "discordLanguage", "values": []string{"en", "cs"}, "maxSelect": 1}))
		if err := app.Save(rooms); err != nil {
			return err
		}
		runs, err := app.FindCollectionByNameOrId("room_runs")
		if err != nil {
			return err
		}
		runs.Fields.Add(field(&core.DateField{}, m{"name": "remindedAt"}))
		return app.Save(runs)
	}, func(app core.App) error {
		if err := removeFields(app, "party_rooms", "discordWebhook", "discordLanguage"); err != nil {
			return err
		}
		return removeFields(app, "room_runs", "remindedAt")
	})
}
