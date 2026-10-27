package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The anonymous rooms of 1791763200_odyle (rooms, members, invites) were replaced by
// the account-based party_rooms, room_members and room_invites in 1791763201_accounts,
// which also locked their API rules. Nothing reads them since, so drop them with
// whatever records they still hold.
func init() {
	register("1791763211_legacy_rooms.js", func(app core.App) error {
		return deleteCollections(app, "invites", "members", "rooms")
	}, func(app core.App) error {
		// Restores the empty, locked collections as 1791763201_accounts left them.
		rooms := collection(m{"name": "rooms", "type": "base", "fields": fields(
			m{"name": "name", "type": "text", "required": true, "max": 60},
			m{"name": "cost", "type": "number", "min": 1, "max": 1000, "onlyInt": true, "required": true},
			m{"name": "expiresAt", "type": "date", "required": true},
			dates(),
		)})
		if err := app.Save(rooms); err != nil {
			return err
		}
		members := collection(m{"name": "members", "type": "auth",
			"passwordAuth": m{"enabled": false}, "authToken": m{"duration": 86400},
			"fields": fields(
				m{"name": "room", "type": "relation", "collectionId": rooms.Id, "cascadeDelete": true, "maxSelect": 1, "required": true},
				m{"name": "role", "type": "select", "values": []string{"owner", "reporter", "viewer"}, "maxSelect": 1, "required": true},
				m{"name": "displayName", "type": "text", "max": 40, "required": true},
				m{"name": "characterName", "type": "text", "max": 40}, m{"name": "server", "type": "text", "max": 40},
				m{"name": "region", "type": "select", "values": []string{"GLOBAL_EU", "GLOBAL_NA", "GLOBAL_SA", "GLOBAL_ASIA"}, "maxSelect": 1},
				m{"name": "value", "type": "number", "min": 0, "max": 1000000, "onlyInt": true},
				m{"name": "confirmed", "type": "bool"}, m{"name": "sharing", "type": "bool"},
				m{"name": "source", "type": "select", "values": []string{"manual", "packet"}, "maxSelect": 1},
				m{"name": "sequence", "type": "number", "min": 0, "max": 9007199254740991, "onlyInt": true},
				m{"name": "sessionId", "type": "text", "hidden": true, "max": 64},
				m{"name": "lastSeenAt", "type": "date"}, m{"name": "lastReadingAt", "type": "date"},
				dates(),
			)})
		invites := collection(m{"name": "invites", "type": "base", "fields": fields(
			m{"name": "room", "type": "relation", "collectionId": rooms.Id, "cascadeDelete": true, "maxSelect": 1, "required": true},
			m{"name": "digest", "type": "text", "required": true},
			m{"name": "role", "type": "select", "values": []string{"reporter", "viewer"}, "maxSelect": 1, "required": true},
			m{"name": "expiresAt", "type": "date", "required": true},
		), "indexes": []string{"CREATE UNIQUE INDEX idx_invite_digest ON invites (digest)"}})
		return saveAll(app, members, invites)
	})
}
