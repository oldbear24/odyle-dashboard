package migrations

import "github.com/pocketbase/pocketbase/core"

// The information board and room features. A room keeps a board its owner and officers write
// for every member (board, up to 2,000 characters with its lines; boardBy is the account that
// wrote it last and boardAt when), hidden so the room list carries none of it: members read it
// in the room's snapshot. features holds the parts of the room its owner turned off or on again
// under Room settings (board, runs, wishlist, week); a part not listed is on. Going back drops
// the board and turns every part on.
func init() {
	register("1791763257_room_board.go", func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("party_rooms")
		if err != nil {
			return err
		}
		rooms.Fields.Add(
			field(&core.TextField{}, m{"name": "board", "max": 2000, "hidden": true}),
			field(&core.TextField{}, m{"name": "boardBy", "max": 30, "hidden": true}),
			field(&core.DateField{}, m{"name": "boardAt", "hidden": true}),
			field(&core.JSONField{}, m{"name": "features", "maxSize": 1000}),
		)
		return app.Save(rooms)
	}, func(app core.App) error {
		return removeFields(app, "party_rooms", "board", "boardBy", "boardAt", "features")
	})
}
