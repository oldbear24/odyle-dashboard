package migrations

import (
	"slices"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The AI starts with Claude Opus 5.5, 20 questions an account in 24 hours and the web on, and no
// account may use it; going down and up again keeps one copy of each of its rate limits, before
// the armory's own.
func TestTheArmoryAiStartsWithItsDefaults(t *testing.T) {
	app := newMigratedApp(t)
	if err := armoryAiDown(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("armory_ai_questions"); err == nil {
		t.Fatal("the questions are still kept")
	}
	if err := armoryAiUp(app); err != nil {
		t.Fatal(err)
	}
	record, err := app.FindFirstRecordByFilter("odyle_settings", `id != ""`)
	if err != nil {
		t.Fatal(err)
	}
	if record.GetString("aiModel") != "claude-opus-5-5" || record.GetInt("aiQuestions") != 20 || !record.GetBool("aiWeb") || record.GetBool("aiPaused") || record.GetString("aiKey") != "" {
		t.Fatalf("settings %v", record)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil || users.Fields.GetByName("armoryAi") == nil || users.UpdateRule != nil {
		t.Fatalf("users %v %v", users, err)
	}
	if key := record.Collection().Fields.GetByName("aiKey"); key == nil || !key.GetHidden() {
		t.Fatalf("key field %v", key)
	}
	rules := app.Settings().RateLimits.Rules
	labels := []string{}
	for _, r := range rules {
		labels = append(labels, r.Label)
	}
	suggest, ai, armory := slices.Index(labels, "/api/odyle/armory/suggest"), slices.Index(labels, "/api/odyle/armory/ai"), slices.Index(labels, "/api/odyle/armory/")
	if suggest < 0 || ai != suggest+1 || armory != ai+1 || slices.IndexFunc(rules[armory+1:], func(r core.RateLimitRule) bool { return r.Label == "/api/odyle/armory/ai" }) >= 0 {
		t.Fatalf("rules %v", labels)
	}
}
