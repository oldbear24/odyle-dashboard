package migrations

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// After every migration each part of the API has a rate limit, and the right one: the labels
// below are what PocketBase looks a rule up by for each request (apis/middlewares_rate_limit.go).
func TestEveryPartOfTheAPIIsRateLimited(t *testing.T) {
	app := newMigratedApp(t)
	limits := app.Settings().RateLimits
	if !limits.Enabled {
		t.Fatal("rate limits are off")
	}
	collectionLabels := func(collection, path string, tags ...string) []string {
		out := []string{}
		for _, tag := range tags {
			out = append(out, collection+":"+tag)
		}
		for _, tag := range tags {
			out = append(out, "*:"+tag)
		}
		return append(out, "POST "+path, path)
	}
	for _, c := range []struct {
		name   string
		labels []string
		want   string
	}{
		{"superuser password sign-in", collectionLabels("_superusers", "/api/collections/_superusers/auth-with-password", "authWithPassword", "auth"), "*:auth"},
		{"account sign-in", collectionLabels("users", "/api/collections/users/auth-with-oauth2", "authWithOAuth2", "auth"), "users:auth"},
		{"superuser password reset", collectionLabels("_superusers", "/api/collections/_superusers/request-password-reset", "requestPasswordReset"), "*:requestPasswordReset"},
		{"superuser one-time password", collectionLabels("_superusers", "/api/collections/_superusers/request-otp", "requestOTP"), "*:requestOTP"},
		{"token refresh", collectionLabels("users", "/api/collections/users/auth-refresh", "authRefresh"), "/api/"},
		{"files", collectionLabels("characters", "/api/files/characters/x/portrait.png", "file"), "/api/"},
		{"realtime", []string{"GET /api/realtime", "/api/realtime"}, "/api/"},
		{"room creation", []string{"POST /api/odyle/create", "/api/odyle/create"}, "/api/odyle/create"},
		{"an Odyle action", []string{"POST /api/odyle/heartbeat", "/api/odyle/heartbeat"}, "/api/odyle/"},
		{"device sign-in", []string{"POST /api/odyle/desktop-sign-in", "/api/odyle/desktop-sign-in"}, "/api/odyle/desktop-sign-in"},
	} {
		rule, ok := limits.FindRateLimitRule(c.labels, core.RateLimitRuleAudienceAll, core.RateLimitRuleAudienceGuest)
		if !ok || rule.Label != c.want {
			t.Errorf("%s: rule %q (found %v), want %q", c.name, rule.Label, ok, c.want)
		}
	}
	if err := app.Settings().RateLimits.Validate(); err != nil {
		t.Fatalf("the rules do not validate: %v", err)
	}
	if err := apiRateLimitsDown(app); err != nil {
		t.Fatal(err)
	}
	if rule, ok := app.Settings().RateLimits.FindRateLimitRule([]string{"_superusers:auth", "*:auth", "/api/realtime"}); ok {
		t.Fatalf("undone, %q stays", rule.Label)
	}
	if err := apiRateLimitsUp(app); err != nil {
		t.Fatal(err)
	}
	if err := apiRateLimitsUp(app); err != nil || len(app.Settings().RateLimits.Rules) != len(limits.Rules) {
		t.Fatalf("run twice: %d rules, %d before (%v)", len(app.Settings().RateLimits.Rules), len(limits.Rules), err)
	}
}
