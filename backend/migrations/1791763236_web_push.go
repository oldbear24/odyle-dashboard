package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Web Push (backend/odyle/push.go): each browser or installed app that turned push on for an
// account keeps its push service endpoint and keys, the language its notifications are
// written in and a short name of the device; it goes with the account, and a push service
// that forgot it removes it. Planned runs keep which reminders went out by push (pushed:
// "account|startsAt|minutes"), hidden from every answer. No API rules: POST
// /api/odyle/push-subscribe and push-unsubscribe write, the export reads.
func init() {
	register("1791763236_web_push.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		subscriptions := collection(m{"name": "push_subscriptions", "type": "base", "fields": fields(
			m{"name": "user", "type": "relation", "collectionId": users.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "endpoint", "type": "text", "required": true, "max": 1000},
			m{"name": "p256dh", "type": "text", "required": true, "max": 200},
			m{"name": "auth", "type": "text", "required": true, "max": 100},
			m{"name": "language", "type": "text", "max": 5},
			m{"name": "device", "type": "text", "max": 60},
			m{"name": "lastOkAt", "type": "date"},
			dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_push_endpoint ON push_subscriptions (endpoint)", "CREATE INDEX idx_push_user ON push_subscriptions (user)"}})
		if err := app.Save(subscriptions); err != nil {
			return err
		}
		runs, err := app.FindCollectionByNameOrId("room_runs")
		if err != nil {
			return err
		}
		runs.Fields.Add(field(&core.JSONField{}, m{"name": "pushed", "maxSize": 20000, "hidden": true}))
		return app.Save(runs)
	}, func(app core.App) error {
		if err := removeFields(app, "room_runs", "pushed"); err != nil {
			return err
		}
		return deleteCollections(app, "push_subscriptions")
	})
}
