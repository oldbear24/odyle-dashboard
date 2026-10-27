package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Personal daily and weekly checklists. One record per task; doneAt is the last time
// the account checked it. Clients show a task as done while that time is on or after
// the start of the current reset period, so nothing has to uncheck tasks at reset and
// nothing is deleted. The reset times are server settings next to odylePerCube: the
// Global service resets at 07:00 UTC, weekly on Wednesday. No API rules:
// GET /api/odyle/tasks reads, POST /api/odyle/task writes.
func init() {
	register("1791763209_user_tasks.js", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		tasks := collection(m{"name": "user_tasks", "type": "base", "fields": fields(
			m{"name": "user", "type": "relation", "collectionId": users.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "title", "type": "text", "required": true, "max": 60},
			m{"name": "cadence", "type": "select", "values": []string{"daily", "weekly"}, "maxSelect": 1, "required": true},
			m{"name": "doneAt", "type": "date"},
			dates(),
		), "indexes": []string{"CREATE INDEX idx_user_tasks_user ON user_tasks (user)"}})
		if err := app.Save(tasks); err != nil {
			return err
		}
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.NumberField{}, m{"name": "dailyResetHour", "min": 0, "max": 23, "onlyInt": true}))
		settings.Fields.Add(field(&core.SelectField{}, m{"name": "weeklyResetDay", "values": []string{"sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"}, "maxSelect": 1}))
		if err := app.Save(settings); err != nil {
			return err
		}
		return setAll(app, "odyle_settings", m{"dailyResetHour": 7, "weeklyResetDay": "wednesday"})
	}, func(app core.App) error {
		if err := deleteCollections(app, "user_tasks"); err != nil {
			return err
		}
		return removeFields(app, "odyle_settings", "dailyResetHour", "weeklyResetDay")
	})
}
