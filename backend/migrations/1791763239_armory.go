package migrations

import "github.com/pocketbase/pocketbase/core"

// The armory (backend/odyle/armory.go): the AION 2 Global character profiles anyone looked
// up, as PLAYNC's official character pages list them, one row per character (search
// region, server id and PLAYNC's character id), with when PLAYNC was last asked and when a
// reader last opened it. hidden keeps a profile out of the armory for good (a superuser
// sets it under Collections when its player asks); the clean-up job deletes the others
// nobody opened for 30 days. No API rules: only the public armory routes read it. Server
// controls get a switch that pauses every PLAYNC lookup of the armory. The armory routes
// get their own rate limits per address, ahead of the general /api/odyle/ one, since
// PocketBase applies the first prefix rule that matches.
func init() {
	const search, armory = "/api/odyle/armory/search", "/api/odyle/armory/"
	register("1791763239_armory.go", func(app core.App) error {
		profiles := collection(m{"name": "armory_profiles", "type": "base", "fields": fields(
			m{"name": "region", "type": "text", "required": true, "max": 5},
			m{"name": "serverId", "type": "number", "required": true, "onlyInt": true, "min": 1000, "max": 2999},
			m{"name": "characterId", "type": "text", "required": true, "max": 100},
			m{"name": "name", "type": "text", "max": 40},
			m{"name": "profile", "type": "json", "maxSize": 100000},
			m{"name": "fetchedAt", "type": "date"},
			m{"name": "viewedAt", "type": "date"},
			m{"name": "error", "type": "text", "max": 300},
			m{"name": "hidden", "type": "bool"},
			dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_armory_character ON armory_profiles (serverId, characterId)", "CREATE INDEX idx_armory_viewed ON armory_profiles (viewedAt)"}})
		if err := app.Save(profiles); err != nil {
			return err
		}
		odyle, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		odyle.Fields.Add(field(&core.BoolField{}, m{"name": "armoryPaused"}))
		if err := app.Save(odyle); err != nil {
			return err
		}
		settings, err := savedSettings(app)
		if err != nil {
			return err
		}
		settings.RateLimits.Rules = append([]core.RateLimitRule{{Label: search, MaxRequests: 20, Duration: 60}, {Label: armory, MaxRequests: 60, Duration: 60}}, settings.RateLimits.Rules...)
		return app.Save(settings)
	}, func(app core.App) error {
		settings, err := savedSettings(app)
		if err != nil {
			return err
		}
		kept := []core.RateLimitRule{}
		for _, r := range settings.RateLimits.Rules {
			if r.Label != search && r.Label != armory {
				kept = append(kept, r)
			}
		}
		settings.RateLimits.Rules = kept
		if err := app.Save(settings); err != nil {
			return err
		}
		if err := removeFields(app, "odyle_settings", "armoryPaused"); err != nil {
			return err
		}
		return deleteCollections(app, "armory_profiles")
	})
}
