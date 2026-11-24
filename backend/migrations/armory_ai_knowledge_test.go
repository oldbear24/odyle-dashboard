package migrations

import (
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"
)

// The knowledge base starts with every seeded entry, superusers only; going down drops it and up
// seeds it again.
func TestTheKnowledgeBaseStartsSeeded(t *testing.T) {
	app := newMigratedApp(t)
	seed, err := knowledgeSeed()
	if err != nil {
		t.Fatal(err)
	}
	if err := armoryAiKnowledgeDown(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("armory_ai_knowledge"); err == nil {
		t.Fatal("the knowledge base is still there")
	}
	if err := armoryAiKnowledgeUp(app); err != nil {
		t.Fatal(err)
	}
	knowledge, err := app.FindCollectionByNameOrId("armory_ai_knowledge")
	if err != nil {
		t.Fatal(err)
	}
	if knowledge.ListRule != nil || knowledge.ViewRule != nil || knowledge.CreateRule != nil || knowledge.UpdateRule != nil || knowledge.DeleteRule != nil {
		t.Fatalf("rules %v", knowledge)
	}
	records, err := app.FindAllRecords("armory_ai_knowledge")
	if err != nil || len(records) != len(seed) {
		t.Fatalf("%d records of %d: %v", len(records), len(seed), err)
	}
	for _, r := range records {
		if r.GetBool("disabled") || r.GetString("body") == "" {
			t.Fatalf("record %v", r)
		}
	}
}

// What the seed holds is fit for the AI: unique names it can ask for, a summary for every guide,
// rules short enough for the instructions (aiRuleLength in backend/odyle), and sources for every
// entry, a link each for the guides.
func TestTheKnowledgeSeedIsSound(t *testing.T) {
	seed, err := knowledgeSeed()
	if err != nil {
		t.Fatal(err)
	}
	names := regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	seen, rules, guides := map[string]bool{}, 0, 0
	for _, e := range seed {
		if !names.MatchString(e.Name) || len(e.Name) > 60 || seen[e.Name] {
			t.Fatalf("name %q", e.Name)
		}
		seen[e.Name] = true
		if e.Title == "" || utf8.RuneCountInString(e.Title) > 120 || e.Body == "" || utf8.RuneCountInString(e.Body) > 20000 || len(e.Sources) == 0 || e.Position < 0 || e.Position > 9999 {
			t.Fatalf("entry %s", e.Name)
		}
		if sources := strings.Join(e.Sources, "\n"); utf8.RuneCountInString(sources) > 4000 {
			t.Fatalf("%s: sources too long", e.Name)
		}
		switch e.Kind {
		case "rule":
			rules++
			if utf8.RuneCountInString(e.Body) > 600 {
				t.Fatalf("rule %s is %d characters", e.Name, utf8.RuneCountInString(e.Body))
			}
		case "guide":
			guides++
			if e.Summary == "" || utf8.RuneCountInString(e.Summary) > 300 {
				t.Fatalf("guide %s: summary", e.Name)
			}
			linked := false
			for _, s := range e.Sources {
				linked = linked || strings.HasPrefix(s, "https://")
			}
			if !linked {
				t.Fatalf("guide %s cites no page", e.Name)
			}
		default:
			t.Fatalf("%s: kind %q", e.Name, e.Kind)
		}
	}
	if rules == 0 || guides == 0 || rules > 40 {
		t.Fatalf("%d rules, %d guides", rules, guides)
	}
}
