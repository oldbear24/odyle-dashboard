package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Game servers (backend/odyle/servers.go): the nightly armory job reads PLAYNC's official server
// list of every region and keeps each server id with its name, and whether a region lists it
// now (open). A server PLAYNC opens past the lists in the code is named from it, so its
// characters are saved and found, and each region's armory form lists the servers it has. No
// API rules: GET /api/odyle/armory/servers lists them.
func init() {
	register("1791763272_game_servers.go", func(app core.App) error {
		return app.Save(collection(m{"name": "game_servers", "type": "base", "fields": fields(
			m{"name": "serverId", "type": "number", "required": true, "onlyInt": true, "min": 1001, "max": 2999},
			m{"name": "name", "type": "text", "required": true, "max": 40},
			m{"name": "open", "type": "bool"},
			dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_game_servers_id ON game_servers (serverId)"}}))
	}, func(app core.App) error {
		return deleteCollections(app, "game_servers")
	})
}
