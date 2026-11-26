package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// A refresh of every character the armory knows (backend/odyle/rankrefresh.go): from
// ranksRefreshAt on, every row of armory_ranks read before it counts as old and the scout reads it
// again, the top players first. ranksRefreshWhy says what started it: "hand" (a superuser, under
// Server status), "level:<level>" (a character above the level cap the armory knew) or
// "power:<percent>" (the combat power of that share of the top players re-read changed a lot).
// Both are empty until the first refresh; only the server writes them.
func init() {
	register("1791763291_armory_refresh.go", armoryRefreshUp, armoryRefreshDown)
}

func armoryRefreshUp(app core.App) error {
	settings, err := app.FindCollectionByNameOrId("odyle_settings")
	if err != nil {
		return err
	}
	settings.Fields.Add(field(&core.DateField{}, m{"name": "ranksRefreshAt"}), field(&core.TextField{}, m{"name": "ranksRefreshWhy", "max": 40}))
	return app.Save(settings)
}

func armoryRefreshDown(app core.App) error {
	return removeFields(app, "odyle_settings", "ranksRefreshAt", "ranksRefreshWhy")
}
