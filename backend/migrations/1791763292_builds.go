package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Builds (backend/odyle/builds.go): characters players put together by clicking, a class's gear,
// skills and Daevanion boards from what the armory keeps of that class (buildcatalog.go). One row
// per build: its account, name, class and plan (what it holds: gear by slot, skills, open nodes,
// notes and the character it was made from), and share, the code of its link while its player
// shares it ("" while private; a new code each time it is shared again). Deleted with its account.
// No API rules: only the builds routes read and write it.
func init() {
	register("1791763292_builds.go", buildsUp, buildsDown)
}

func buildsUp(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	return app.Save(collection(m{"name": "builds", "type": "base", "fields": fields(
		m{"name": "user", "type": "relation", "collectionId": users.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
		m{"name": "name", "type": "text", "required": true, "max": 60},
		m{"name": "class", "type": "text", "required": true, "max": 40},
		m{"name": "plan", "type": "json", "maxSize": 65536},
		m{"name": "share", "type": "text", "max": 24},
		dates(),
	), "indexes": []string{
		"CREATE INDEX idx_builds_user ON builds (user, updated)",
		"CREATE UNIQUE INDEX idx_builds_share ON builds (share) WHERE share != ''",
	}}))
}

func buildsDown(app core.App) error {
	return deleteCollections(app, "builds")
}
