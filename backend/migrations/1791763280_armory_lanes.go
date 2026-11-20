package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The armory's queue runs several lookups at once (backend/odyle/armory.go): armoryLanes readers'
// lookups (1 to 10, 3 until a superuser sets another number under Server controls) and, beside
// them, scoutLanes of the scout's (0 to 5, 1; 0 lets the scout read no gear).
func init() {
	register("1791763280_armory_lanes.go", armoryLanesUp, armoryLanesDown)
}

func armoryLanesUp(app core.App) error {
	settings, err := app.FindCollectionByNameOrId("odyle_settings")
	if err != nil {
		return err
	}
	settings.Fields.Add(field(&core.NumberField{}, m{"name": "armoryLanes", "min": 0, "max": 10, "onlyInt": true}), field(&core.NumberField{}, m{"name": "scoutLanes", "min": 0, "max": 5, "onlyInt": true}))
	if err := app.Save(settings); err != nil {
		return err
	}
	return setAll(app, "odyle_settings", m{"armoryLanes": 3, "scoutLanes": 1})
}

func armoryLanesDown(app core.App) error {
	return removeFields(app, "odyle_settings", "armoryLanes", "scoutLanes")
}
