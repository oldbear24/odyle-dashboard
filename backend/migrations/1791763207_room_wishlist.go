package migrations

import "github.com/pocketbase/pocketbase/core"

// Dungeons room members still need to run. One record per member and dungeon; key is
// the normalized name, so "Fire temple" and "fire  Temple" are one entry. Records
// belong to the membership, so leaving, removal or closing the room deletes them. No
// API rules: rooms read the list through the snapshot route and change it through
// POST /api/odyle/wishlist.
func init() {
	register("1791763207_room_wishlist.js", func(app core.App) error {
		rooms, err := app.FindCollectionByNameOrId("party_rooms")
		if err != nil {
			return err
		}
		members, err := app.FindCollectionByNameOrId("room_members")
		if err != nil {
			return err
		}
		return app.Save(collection(m{"name": "room_wishes", "type": "base", "fields": fields(
			m{"name": "room", "type": "relation", "collectionId": rooms.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "member", "type": "relation", "collectionId": members.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "dungeon", "type": "text", "required": true, "max": 60}, m{"name": "key", "type": "text", "required": true, "max": 60},
			dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_room_wish ON room_wishes (member, key)", "CREATE INDEX idx_room_wishes_room ON room_wishes (room)"}}))
	}, func(app core.App) error {
		return deleteCollections(app, "room_wishes")
	})
}
