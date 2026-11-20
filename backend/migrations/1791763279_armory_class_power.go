package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Each kept armory profile names its class and combat power in fields of their own, indexed
// together, so the armory's Upgrade tab finds the strongest characters of a class without
// reading every profile (backend/odyle/upgrades.go). The backend fills them from the profile
// whenever a profile is saved; here they are filled from the profiles kept so far.
func init() {
	register("1791763279_armory_class_power.go", armoryClassPowerUp, armoryClassPowerDown)
}

func armoryClassPowerUp(app core.App) error {
	profiles, err := app.FindCollectionByNameOrId("armory_profiles")
	if err != nil {
		return err
	}
	profiles.Fields.Add(field(&core.TextField{}, m{"name": "class", "max": 40}), field(&core.NumberField{}, m{"name": "combatPower", "onlyInt": true, "min": 0}))
	profiles.AddIndex("idx_armory_class_power", false, "`class`, `combatPower`", "")
	if err := app.Save(profiles); err != nil {
		return err
	}
	_, err = app.DB().NewQuery("UPDATE armory_profiles SET class = COALESCE(SUBSTR(json_extract(profile, '$.class'), 1, 40), ''), combatPower = MAX(0, COALESCE(CAST(json_extract(profile, '$.combatPower') AS INTEGER), 0)) WHERE json_valid(profile) AND json_type(profile) = 'object'").Execute()
	return err
}

func armoryClassPowerDown(app core.App) error {
	profiles, err := app.FindCollectionByNameOrId("armory_profiles")
	if err != nil {
		return err
	}
	profiles.RemoveIndex("idx_armory_class_power")
	if err := app.Save(profiles); err != nil {
		return err
	}
	return removeFields(app, "armory_profiles", "class", "combatPower")
}
