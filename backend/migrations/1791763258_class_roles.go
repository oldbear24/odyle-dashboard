package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Class roles (#45): odyle_settings.classRoles is a list of { class, role } (tank, healer, support
// or damage), kept under Game settings; planned runs show their party's make-up and the roles it
// misses. Empty until a superuser saves it: the backend's default table applies until then.
func init() {
	register("1791763258_class_roles.go", func(app core.App) error {
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "classRoles", "maxSize": 8000}))
		return app.Save(settings)
	}, func(app core.App) error {
		return removeFields(app, "odyle_settings", "classRoles")
	})
}
