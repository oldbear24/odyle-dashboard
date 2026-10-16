package migrations

import "github.com/pocketbase/pocketbase/core"

// New characters can reach a room on their own: a member who turns shareNew on for a room has
// each character they save from then on shared there (backend/odyle/accounts.go shareNew).
// Off for every membership, so new characters still start private.
func init() {
	register("1791763237_share_new.go", func(app core.App) error {
		members, err := app.FindCollectionByNameOrId("room_members")
		if err != nil {
			return err
		}
		members.Fields.Add(field(&core.BoolField{}, m{"name": "shareNew"}))
		return app.Save(members)
	}, func(app core.App) error {
		return removeFields(app, "room_members", "shareNew")
	})
}
