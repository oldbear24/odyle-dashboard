package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Lasting pairings of Windows apps. Pairing hands the app a device key; the server keeps
// only its digest. The app trades the key for a fresh account token whenever it starts
// or its seven-day token runs out, so a paired PC stays connected however long it is
// closed, until the app disconnects, the account signs out everywhere or is deleted. No
// API rules: the /api/odyle routes read and write them.
func init() {
	register("1791763217_desktop_devices.js", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		devices := collection(m{"name": "desktop_devices", "type": "base", "fields": fields(
			m{"name": "user", "type": "relation", "collectionId": users.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
			m{"name": "digest", "type": "text", "required": true},
			m{"name": "lastUsedAt", "type": "date"},
			dates(),
		), "indexes": []string{"CREATE UNIQUE INDEX idx_desktop_device ON desktop_devices (digest)", "CREATE INDEX idx_desktop_devices_user ON desktop_devices (user)"}})
		if err := app.Save(devices); err != nil {
			return err
		}
		// Device sign-in and unpairing are public like pairing. A key has 48 random
		// characters, so their cap only stops runaway clients: an app signs in at start
		// and once a day.
		settings := app.Settings()
		settings.RateLimits.Rules = append(settings.RateLimits.Rules, core.RateLimitRule{Label: "/api/odyle/desktop-sign-in", MaxRequests: 30, Duration: 60}, core.RateLimitRule{Label: "/api/odyle/unpair", MaxRequests: 30, Duration: 60})
		return app.Save(settings)
	}, func(app core.App) error {
		if err := deleteCollections(app, "desktop_devices"); err != nil {
			return err
		}
		settings := app.Settings()
		kept := []core.RateLimitRule{}
		for _, r := range settings.RateLimits.Rules {
			if r.Label != "/api/odyle/desktop-sign-in" && r.Label != "/api/odyle/unpair" {
				kept = append(kept, r)
			}
		}
		settings.RateLimits.Rules = kept
		return app.Save(settings)
	})
}
