package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The characters a member shares in a room move from a list on the membership
// (room_members.sharedCharacters, up to 500 ids as JSON) into room_shares, one row a character
// and room: the membership, its room and the character. The rooms a character is shared in are
// then one indexed lookup instead of a search through every membership's list, and a share goes
// with its membership or its character. Each membership's characters keep the order they were
// shared in; an id of a character that is gone or not the member's own is left behind. No API
// rules: rooms, snapshots and the sharing route answer with the shared characters as before.
func init() {
	register("1791763277_room_shares.go", roomSharesUp, roomSharesDown)
}

func roomSharesUp(app core.App) error {
	members, err := app.FindCollectionByNameOrId("room_members")
	if err != nil {
		return err
	}
	rooms, err := app.FindCollectionByNameOrId("party_rooms")
	if err != nil {
		return err
	}
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		return err
	}
	shares := collection(m{"name": "room_shares", "type": "base", "fields": fields(
		m{"name": "member", "type": "relation", "collectionId": members.Id, "cascadeDelete": true, "maxSelect": 1, "required": true},
		m{"name": "room", "type": "relation", "collectionId": rooms.Id, "cascadeDelete": true, "maxSelect": 1, "required": true},
		m{"name": "character", "type": "relation", "collectionId": characters.Id, "cascadeDelete": true, "maxSelect": 1, "required": true},
		m{"name": "created", "type": "autodate", "onCreate": true},
	), "indexes": []string{
		"CREATE UNIQUE INDEX idx_room_shares_member ON room_shares (member, character)",
		"CREATE INDEX idx_room_shares_character ON room_shares (character)",
		"CREATE INDEX idx_room_shares_room ON room_shares (room)",
	}})
	if err := app.Save(shares); err != nil {
		return err
	}
	if _, err := app.DB().NewQuery("INSERT OR IGNORE INTO room_shares (member, room, character, created) " +
		"SELECT m.id, m.room, c.id, strftime('%Y-%m-%d %H:%M:%fZ', 'now') FROM room_members m, " +
		"json_each(CASE WHEN json_valid(m.sharedCharacters) THEN m.sharedCharacters ELSE '[]' END) s JOIN characters c ON c.id = s.value AND c.user = m.user " +
		"ORDER BY m.id, s.key").Execute(); err != nil {
		return err
	}
	return removeFields(app, "room_members", "sharedCharacters")
}

func roomSharesDown(app core.App) error {
	members, err := app.FindCollectionByNameOrId("room_members")
	if err != nil {
		return err
	}
	characters, err := app.FindCollectionByNameOrId("characters")
	if err != nil {
		return err
	}
	members.Fields.Add(field(&core.RelationField{}, m{"name": "sharedCharacters", "collectionId": characters.Id, "maxSelect": 500, "cascadeDelete": false}))
	if err := app.Save(members); err != nil {
		return err
	}
	if _, err := app.DB().NewQuery("UPDATE room_members SET sharedCharacters = " +
		"(SELECT json_group_array(character) FROM (SELECT character FROM room_shares WHERE member = room_members.id ORDER BY rowid)) " +
		"WHERE id IN (SELECT member FROM room_shares)").Execute(); err != nil {
		return err
	}
	return deleteCollections(app, "room_shares")
}
