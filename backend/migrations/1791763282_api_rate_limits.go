package migrations

import (
	"slices"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The first migration replaced PocketBase's default rate limits with the /api/odyle/ ones,
// which left the rest of the API without any: the superusers' password sign-in, password
// resets, realtime and files. Signing in to any collection now gets the brute-force cap the
// accounts have (users:auth, 1791763201_accounts, stays first for them), the requests that
// send an email get a small one, and every other API path the cap of PocketBase's defaults.
// The catch-all comes last: PocketBase takes the first rule whose path is a prefix, so the
// /api/odyle/ rules keep theirs. Rules an operator added with the same labels stay as they are.
var apiRateLimits = []core.RateLimitRule{
	{Label: "*:auth", MaxRequests: 10, Duration: 60},
	{Label: "*:requestPasswordReset", MaxRequests: 5, Duration: 60},
	{Label: "*:requestOTP", MaxRequests: 5, Duration: 60},
	{Label: "*:requestVerification", MaxRequests: 5, Duration: 60},
	{Label: "*:requestEmailChange", MaxRequests: 5, Duration: 60},
	{Label: "/api/", MaxRequests: 300, Duration: 10},
}

func init() {
	register("1791763282_api_rate_limits.go", apiRateLimitsUp, apiRateLimitsDown)
}

func apiRateLimitsUp(app core.App) error {
	settings := app.Settings()
	for _, rule := range apiRateLimits {
		if !slices.ContainsFunc(settings.RateLimits.Rules, func(r core.RateLimitRule) bool { return r.Label == rule.Label }) {
			settings.RateLimits.Rules = append(settings.RateLimits.Rules, rule)
		}
	}
	settings.RateLimits.Enabled = true
	return app.Save(settings)
}

func apiRateLimitsDown(app core.App) error {
	settings := app.Settings()
	settings.RateLimits.Rules = slices.DeleteFunc(settings.RateLimits.Rules, func(r core.RateLimitRule) bool {
		return slices.ContainsFunc(apiRateLimits, func(a core.RateLimitRule) bool { return a == r })
	})
	return app.Save(settings)
}
