package migrations

import (
	"slices"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory's search box and its AI (backend/odyle/armoryfind.go, armoryai.go).
//
// armory_ranks gets an index of what a suggestion lists by name, so suggesting the characters the
// armory knows while a reader types scans the index and never the builds.
//
// The AI answers questions about characters with Anthropic's Claude: a superuser saves the
// Anthropic API key under Server controls (aiKey, never sent back to a browser), the model (aiModel),
// how many questions an account may ask in 24 hours (aiQuestions, 20 until set) and whether it may
// search the web (aiWeb, on until set), and may pause it (aiPaused). Only the accounts a superuser
// lets use it may (users.armoryAi; accounts cannot change their own record since
// 1791763218_profile_lock). armory_ai_questions keeps one row per question an account asked, for
// the limit and the superusers' overview: who asked, when, the model and the tokens it took, never
// the question or the answer; the nightly armory job deletes rows older than 30 days. No API rules:
// only the AI routes read and write it.
//
// The suggestions and the AI get their own rate limits per address, ahead of the armory's
// (PocketBase applies the first prefix rule that matches).
var armoryAiRateLimits = []core.RateLimitRule{
	{Label: "/api/odyle/armory/suggest", MaxRequests: 120, Duration: 60},
	{Label: "/api/odyle/armory/ai", MaxRequests: 20, Duration: 60},
}

func init() {
	register("1791763289_armory_ai.go", armoryAiUp, armoryAiDown)
}

func armoryAiUp(app core.App) error {
	ranks, err := app.FindCollectionByNameOrId("armory_ranks")
	if err != nil {
		return err
	}
	ranks.AddIndex("idx_armory_ranks_name", false, "`name` COLLATE NOCASE, `region`, `serverId`, `characterId`, `class`, `level`, `combatPower`, `itemLevel`, `portrait`, `checkedAt`, `hidden`", "`hidden` = FALSE")
	if err := app.Save(ranks); err != nil {
		return err
	}
	odyle, err := app.FindCollectionByNameOrId("odyle_settings")
	if err != nil {
		return err
	}
	odyle.Fields.Add(
		field(&core.TextField{}, m{"name": "aiKey", "max": 300, "hidden": true}),
		field(&core.TextField{}, m{"name": "aiModel", "max": 60}),
		field(&core.NumberField{}, m{"name": "aiQuestions", "min": 0, "max": 500, "onlyInt": true}),
		field(&core.BoolField{}, m{"name": "aiPaused"}),
		field(&core.BoolField{}, m{"name": "aiWeb"}),
	)
	if err := app.Save(odyle); err != nil {
		return err
	}
	if err := setAll(app, "odyle_settings", m{"aiModel": "claude-opus-5-5", "aiQuestions": 20, "aiWeb": true}); err != nil {
		return err
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.Fields.Add(field(&core.BoolField{}, m{"name": "armoryAi"}))
	if err := app.Save(users); err != nil {
		return err
	}
	questions := collection(m{"name": "armory_ai_questions", "type": "base", "fields": fields(
		m{"name": "user", "type": "relation", "collectionId": users.Id, "maxSelect": 1, "cascadeDelete": true, "required": true},
		m{"name": "model", "type": "text", "max": 60},
		m{"name": "inputTokens", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "outputTokens", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "cachedTokens", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "webSearches", "type": "number", "onlyInt": true, "min": 0},
		m{"name": "ok", "type": "bool"},
		m{"name": "error", "type": "text", "max": 300},
		dates(),
	), "indexes": []string{
		"CREATE INDEX idx_armory_ai_questions_user ON armory_ai_questions (user, created)",
		"CREATE INDEX idx_armory_ai_questions_created ON armory_ai_questions (created)",
	}})
	if err := app.Save(questions); err != nil {
		return err
	}
	settings, err := savedSettings(app)
	if err != nil {
		return err
	}
	at := slices.IndexFunc(settings.RateLimits.Rules, func(r core.RateLimitRule) bool { return r.Label == "/api/odyle/armory/" })
	if at < 0 {
		at = len(settings.RateLimits.Rules)
	}
	for _, rule := range armoryAiRateLimits {
		if !slices.ContainsFunc(settings.RateLimits.Rules, func(r core.RateLimitRule) bool { return r.Label == rule.Label }) {
			settings.RateLimits.Rules = slices.Insert(settings.RateLimits.Rules, at, rule)
			at++
		}
	}
	return app.Save(settings)
}

func armoryAiDown(app core.App) error {
	settings, err := savedSettings(app)
	if err != nil {
		return err
	}
	settings.RateLimits.Rules = slices.DeleteFunc(settings.RateLimits.Rules, func(r core.RateLimitRule) bool {
		return slices.Contains(armoryAiRateLimits, r)
	})
	if err := app.Save(settings); err != nil {
		return err
	}
	if err := deleteCollections(app, "armory_ai_questions"); err != nil {
		return err
	}
	if err := removeFields(app, "users", "armoryAi"); err != nil {
		return err
	}
	if err := removeFields(app, "odyle_settings", "aiKey", "aiModel", "aiQuestions", "aiPaused", "aiWeb"); err != nil {
		return err
	}
	ranks, err := app.FindCollectionByNameOrId("armory_ranks")
	if err != nil {
		return err
	}
	ranks.RemoveIndex("idx_armory_ranks_name")
	return app.Save(ranks)
}
