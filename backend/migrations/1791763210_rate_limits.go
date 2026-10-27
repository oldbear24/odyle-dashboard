package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Room creation, joins and the application routes were capped tightly while the
// service was new. Abuse has not been a concern, so the limits now only stop a runaway
// client: the dashboard polls every open room every 15 seconds and the Windows app adds
// its heartbeat, party and checklist reads. Pairing and sign-in keep their brute-force
// caps from 1791763201_accounts.
func init() {
	budget := func(limits map[string]int) func(app core.App) error {
		return func(app core.App) error {
			settings := app.Settings()
			for i, r := range settings.RateLimits.Rules {
				if limit, ok := limits[r.Label]; ok {
					settings.RateLimits.Rules[i].MaxRequests = limit
				}
			}
			return app.Save(settings)
		}
	}
	register("1791763210_rate_limits.js",
		budget(map[string]int{"/api/odyle/create": 30, "/api/odyle/join": 30, "/api/odyle/": 600}),
		budget(map[string]int{"/api/odyle/create": 5, "/api/odyle/join": 10, "/api/odyle/": 120}))
}
