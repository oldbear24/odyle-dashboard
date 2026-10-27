package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// Invite links an owner makes one by one: who made each link, an optional label, a use
// limit with the joins so far and when it was made, so the owner can list the room's
// links from any browser (never their codes: the server keeps only digests) and revoke
// one. The public invite preview, which tells whoever holds a code which room it opens,
// gets its own rate limit per address. Links made before keep working; they have no
// maker (the room owner stands in) and no use limit.
func init() {
	const preview = "/api/odyle/invite-preview"
	register("1791763231_invite_links.go", func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		invites, err := app.FindCollectionByNameOrId("room_invites")
		if err != nil {
			return err
		}
		invites.Fields.Add(
			field(&core.RelationField{}, m{"name": "createdBy", "collectionId": users.Id, "maxSelect": 1}),
			field(&core.TextField{}, m{"name": "label", "max": 40}),
			field(&core.NumberField{}, m{"name": "maxUses", "min": 0, "max": 50, "onlyInt": true}),
			field(&core.NumberField{}, m{"name": "uses", "min": 0, "onlyInt": true}),
			field(&core.AutodateField{}, m{"name": "created", "onCreate": true}),
		)
		if err := app.Save(invites); err != nil {
			return err
		}
		settings, err := savedSettings(app)
		if err != nil {
			return err
		}
		settings.RateLimits.Rules = append(settings.RateLimits.Rules, core.RateLimitRule{Label: preview, MaxRequests: 30, Duration: 60})
		return app.Save(settings)
	}, func(app core.App) error {
		if err := removeFields(app, "room_invites", "createdBy", "label", "maxUses", "uses", "created"); err != nil {
			return err
		}
		settings, err := savedSettings(app)
		if err != nil {
			return err
		}
		kept := []core.RateLimitRule{}
		for _, r := range settings.RateLimits.Rules {
			if r.Label != preview {
				kept = append(kept, r)
			}
		}
		settings.RateLimits.Rules = kept
		return app.Save(settings)
	})
}
