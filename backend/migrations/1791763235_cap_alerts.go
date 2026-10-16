package migrations

import "github.com/pocketbase/pocketbase/core"

// Cap alerts (backend/odyle/capalerts.go): the last state a character's owner was told of,
// soon or full (empty: neither), so alerts are not repeated after a restart. Hidden from
// every answer: rooms never see it.
func init() {
	register("1791763235_cap_alerts.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		characters.Fields.Add(field(&core.TextField{}, m{"name": "capAlert", "max": 10, "hidden": true}))
		return app.Save(characters)
	}, func(app core.App) error {
		return removeFields(app, "characters", "capAlert")
	})
}
