package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The teammates switch (backend/odyle/teammates.go): since Windows 0.35.0 the app sends the names
// of its character's party and force members for the armory scout. An account that turns that
// off sets users.teammatesOff; false, as every account has it until then, sends them, so the
// switch is on for new and existing accounts alike. POST /api/odyle/teammates-sharing saves it.
func init() {
	register("1791763283_teammates_switch.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.Add(field(&core.BoolField{}, m{"name": "teammatesOff"}))
		return app.Save(users)
	}, func(app core.App) error {
		return removeFields(app, "users", "teammatesOff")
	})
}
