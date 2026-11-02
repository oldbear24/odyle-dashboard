package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The audit log of the superuser dashboard (backend/odyle/audit.go, #55): what superusers did
// to Odyle, by whom and when. Only the server writes it, so it is a system collection (it
// cannot be deleted or its API rules opened) without API rules (superusers only), and the
// backend refuses to add, change or delete its records through the API. odyle_settings gains
// the announcement's schedule: it shows from announcementFrom until announcementUntil, an
// empty one meaning no limit, so existing announcements show as before.
func init() {
	register("1791763268_audit_log.go", func(app core.App) error {
		audit := collection(m{"name": "odyle_audit", "type": "base", "system": true, "fields": fields(
			m{"name": "kind", "type": "text", "required": true, "max": 20},
			m{"name": "via", "type": "text", "max": 20},
			m{"name": "actor", "type": "text", "max": 30},
			m{"name": "actorEmail", "type": "text", "max": 255},
			m{"name": "summary", "type": "text", "max": 1000},
			m{"name": "details", "type": "json", "maxSize": 500000},
			m{"name": "created", "type": "autodate", "onCreate": true},
		), "indexes": []string{
			"CREATE INDEX idx_odyle_audit_created ON odyle_audit (created)",
			"CREATE INDEX idx_odyle_audit_kind ON odyle_audit (kind, created)",
			"CREATE INDEX idx_odyle_audit_actor ON odyle_audit (actor, created)",
		}})
		if err := app.Save(audit); err != nil {
			return err
		}
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.DateField{}, m{"name": "announcementFrom"}))
		settings.Fields.Add(field(&core.DateField{}, m{"name": "announcementUntil"}))
		return app.Save(settings)
	}, func(app core.App) error {
		if err := removeFields(app, "odyle_settings", "announcementFrom", "announcementUntil"); err != nil {
			return err
		}
		audit, err := app.FindCollectionByNameOrId("odyle_audit")
		if err != nil {
			return err
		}
		// PocketBase deletes no system collection, and validation refuses to unmark one.
		audit.System = false
		if err := app.SaveNoValidate(audit); err != nil {
			return err
		}
		return app.Delete(audit)
	})
}
