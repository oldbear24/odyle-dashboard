package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// armory_ranks: every AION 2 Global character the armory knows the combat power of, for its
// top players by class and the Upgrade tab (backend/odyle/ranks.go, scout.go, upgrades.go). A
// row is a character (search region, server id and PLAYNC's character id) with its name, class,
// level, combat power, item level and portrait as PLAYNC's pages list them, and, once its gear was
// read, build: what the Upgrade tab compares of it (each item's slot, name, grade, enchantment,
// exceed level, item level, stones, set and where it comes from; the Daevanion boards' open nodes;
// the skills on its skill bar). Profiles readers open fill it, and so does the scout, which reads
// PLAYNC's character search slowly in the background. hidden keeps a character out of the top
// players and the scout for good (a superuser sets it under Collections, or it follows the
// profile's hidden switch). No API rules: only the public armory routes read it.
func init() {
	register("1791763279_armory_ranks.go", armoryRanksUp, armoryRanksDown)
}

func armoryRanksUp(app core.App) error {
	return app.Save(collection(m{"name": "armory_ranks", "type": "base", "fields": fields(
		m{"name": "region", "type": "text", "required": true, "max": 5},
		m{"name": "serverId", "type": "number", "required": true, "onlyInt": true, "min": 1000, "max": 2999},
		m{"name": "characterId", "type": "text", "required": true, "max": 100},
		m{"name": "name", "type": "text", "max": 40},
		m{"name": "class", "type": "text", "max": 40},
		m{"name": "level", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "combatPower", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "itemLevel", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "portrait", "type": "text", "max": 110},
		m{"name": "build", "type": "json", "maxSize": 100000},
		m{"name": "checkedAt", "type": "date"},
		m{"name": "builtAt", "type": "date"},
		m{"name": "hidden", "type": "bool"},
		dates(),
	), "indexes": []string{
		"CREATE UNIQUE INDEX idx_armory_ranks_character ON armory_ranks (serverId, characterId)",
		"CREATE INDEX idx_armory_ranks_class ON armory_ranks (class, combatPower)",
		"CREATE INDEX idx_armory_ranks_checked ON armory_ranks (checkedAt)",
	}}))
}

func armoryRanksDown(app core.App) error {
	return deleteCollections(app, "armory_ranks")
}
