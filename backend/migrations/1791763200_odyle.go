package migrations

import "github.com/pocketbase/pocketbase/core"

// The first release: anonymous rooms with their own member logins (dropped in
// 1791763211_legacy_rooms) and the server settings.
func init() {
	register("1791763200_odyle.js", func(app core.App) error {
		rooms := collection(m{"name": "rooms", "type": "base", "fields": fields(
			m{"name": "name", "type": "text", "required": true, "max": 60},
			m{"name": "cost", "type": "number", "min": 1, "max": 1000, "onlyInt": true, "required": true},
			m{"name": "expiresAt", "type": "date", "required": true},
			dates(),
		), "listRule": nil, "viewRule": nil, "createRule": nil, "updateRule": nil, "deleteRule": nil})
		if err := app.Save(rooms); err != nil {
			return err
		}
		member := `@request.auth.id != "" && room = @request.auth.room && room.expiresAt > @now`
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
			), "listRule": member, "viewRule": member, "createRule": nil, "updateRule": nil, "deleteRule": nil, "manageRule": nil})
		if err := app.Save(members); err != nil {
			return err
		}
		rule := `@request.auth.id != "" && id = @request.auth.room && expiresAt > @now`
		rooms.ListRule, rooms.ViewRule = &rule, &rule
		if err := app.Save(rooms); err != nil {
			return err
		}
		invites := collection(m{"name": "invites", "type": "base", "fields": fields(
			m{"name": "room", "type": "relation", "collectionId": rooms.Id, "cascadeDelete": true, "maxSelect": 1, "required": true},
			m{"name": "digest", "type": "text", "required": true},
			m{"name": "role", "type": "select", "values": []string{"reporter", "viewer"}, "maxSelect": 1, "required": true},
			m{"name": "expiresAt", "type": "date", "required": true},
		), "indexes": []string{"CREATE UNIQUE INDEX idx_invite_digest ON invites (digest)"}})
		if err := app.Save(invites); err != nil {
			return err
		}
		settings := app.Settings()
		settings.Meta.AppName = "Odyle Party"
		settings.Logs.MaxDays = 0
		settings.Logs.LogIP = false
		settings.Logs.LogAuthId = false
		settings.RateLimits.Enabled = true
		settings.RateLimits.Rules = []core.RateLimitRule{
			{Label: "/api/odyle/create", MaxRequests: 5, Duration: 60},
			{Label: "/api/odyle/join", MaxRequests: 10, Duration: 60},
			{Label: "/api/odyle/", MaxRequests: 120, Duration: 60},
		}
		return app.Save(settings)
	}, func(app core.App) error {
		return deleteCollections(app, "invites", "members", "rooms")
	})
}
