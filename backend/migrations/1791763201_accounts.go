package migrations

import (
	"os"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Discord accounts: users sign in with Discord only, keep their characters and join
// private party rooms; Windows apps pair with a one-time desktop code. The anonymous
// collections of the first release are locked.
func init() {
	register("1791763201_accounts.js", func(app core.App) error {
		for _, name := range []string{"rooms", "members", "invites"} {
			old, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}
			old.ListRule, old.ViewRule = nil, nil
			if err := app.Save(old); err != nil {
				return err
			}
		}
		clientId, clientSecret := os.Getenv("DISCORD_CLIENT_ID"), os.Getenv("DISCORD_CLIENT_SECRET")
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		self := "id = @request.auth.id"
		users.CreateRule, users.DeleteRule, users.ManageRule = nil, nil, nil
		users.ListRule, users.ViewRule, users.UpdateRule = &self, &self, &self
		users.Fields.Add(field(&core.TextField{}, m{"name": "displayName", "required": true, "max": 40}))
		users.PasswordAuth.Enabled = false
		providers := []core.OAuth2ProviderConfig{}
		if clientId != "" && clientSecret != "" {
			providers = append(providers, core.OAuth2ProviderConfig{Name: "discord", ClientId: clientId, ClientSecret: clientSecret})
		}
		users.OAuth2.Enabled, users.OAuth2.Providers = clientId != "" && clientSecret != "", providers
		users.AuthToken.Duration = 604800
		if err := app.Save(users); err != nil {
			return err
		}
		own := "user = @request.auth.id"
		rooms := collection(m{"name": "party_rooms", "type": "base", "fields": fields(
			m{"name": "owner", "type": "relation", "collectionId": users.Id, "maxSelect": 1, "required": true},
			m{"name": "name", "type": "text", "required": true, "max": 60}, m{"name": "cost", "type": "number", "min": 1, "max": 1000, "onlyInt": true, "required": true}, dates(),
		)})
		if err := app.Save(rooms); err != nil {
			return err
		}
		relation := m{"name": "user", "type": "relation", "collectionId": users.Id, "maxSelect": 1, "cascadeDelete": true, "required": true}
		sessions := collection(m{"name": "publisher_sessions", "type": "base", "fields": fields(relation,
			m{"name": "sequence", "type": "number", "onlyInt": true, "min": 0, "max": 9007199254740991},
			m{"name": "expiresAt", "type": "date", "required": true}, dates(),
		)})
		if err := app.Save(sessions); err != nil {
			return err
		}
		characters := collection(m{"name": "characters", "type": "base", "listRule": own, "viewRule": own, "fields": fields(relation,
			m{"name": "characterName", "type": "text", "required": true, "max": 40}, m{"name": "server", "type": "text", "required": true, "max": 40},
			m{"name": "region", "type": "select", "values": []string{"GLOBAL_EU", "GLOBAL_NA", "GLOBAL_SA", "GLOBAL_ASIA"}, "required": true, "maxSelect": 1},
			m{"name": "value", "type": "number", "min": 0, "max": 1000000, "onlyInt": true}, m{"name": "confirmed", "type": "bool"}, m{"name": "valid", "type": "bool"},
			m{"name": "source", "type": "select", "values": []string{"manual", "packet"}, "maxSelect": 1},
			m{"name": "readingSession", "type": "relation", "collectionId": sessions.Id, "maxSelect": 1, "hidden": true},
			m{"name": "lastReadingAt", "type": "date"}, m{"name": "lastSeenAt", "type": "date"}, dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_character_identity ON characters (user, region, server, characterName)"}})
		members := collection(m{"name": "room_members", "type": "base", "listRule": own, "viewRule": own, "fields": fields(relation,
			m{"name": "room", "type": "relation", "collectionId": rooms.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "role", "type": "select", "values": []string{"owner", "reporter", "viewer"}, "maxSelect": 1, "required": true}, m{"name": "sharing", "type": "bool"}, dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_room_user ON room_members (room, user)"}})
		invites := collection(m{"name": "room_invites", "type": "base", "fields": fields(
			m{"name": "room", "type": "relation", "collectionId": rooms.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "digest", "type": "text", "required": true}, m{"name": "role", "type": "select", "values": []string{"reporter", "viewer"}, "required": true, "maxSelect": 1},
			m{"name": "expiresAt", "type": "date", "required": true},
		), "indexes": []string{"CREATE UNIQUE INDEX idx_room_code ON room_invites (digest)"}})
		codes := collection(m{"name": "desktop_codes", "type": "base", "fields": fields(relation,
			m{"name": "digest", "type": "text", "required": true}, m{"name": "expiresAt", "type": "date", "required": true},
		), "indexes": []string{"CREATE UNIQUE INDEX idx_desktop_code ON desktop_codes (digest)"}})
		if err := saveAll(app, characters, members, invites, codes); err != nil {
			return err
		}
		settings := app.Settings()
		settings.RateLimits.Rules = append(settings.RateLimits.Rules, core.RateLimitRule{Label: "/api/odyle/pair", MaxRequests: 10, Duration: 60}, core.RateLimitRule{Label: "users:auth", MaxRequests: 10, Duration: 60})
		return app.Save(settings)
	}, func(app core.App) error {
		return deleteCollections(app, "desktop_codes", "room_invites", "room_members", "characters", "publisher_sessions", "party_rooms", "users")
	})
}
