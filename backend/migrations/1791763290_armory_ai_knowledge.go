package migrations

import (
	_ "embed"
	"encoding/json"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// armory_ai_knowledge: the armory AI's knowledge base of AION 2's gear (backend/odyle/aiknowledge.go),
// kept by superusers under Collections → armory_ai_knowledge. An entry is a rule (a best practice the
// AI follows in every answer: its body goes into the AI's instructions) or a guide (a mechanic at
// length, listed in the instructions by name, title and summary, and read by the AI when a question
// needs it). name is how the AI asks for a guide (lower case words and dashes, unique); sources are
// the pages the entry rests on, one a line; position orders the entries (lower first); disabled
// leaves an entry out without deleting it. No API rules: superusers only.
//
// It starts with the entries of 1791763290_armory_ai_knowledge.json, researched from PLAYNC's notices
// and the players' guides in November 2026, each with its sources. Superusers correct them from then
// on; a later release that improves a seeded entry must leave one a superuser changed alone (its
// updated date is past its created date).
func init() {
	register("1791763290_armory_ai_knowledge.go", armoryAiKnowledgeUp, armoryAiKnowledgeDown)
}

//go:embed 1791763290_armory_ai_knowledge.json
var armoryAiKnowledgeSeed []byte

// knowledgeEntry is an entry of the seed.
type knowledgeEntry struct {
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Title    string   `json:"title"`
	Summary  string   `json:"summary"`
	Body     string   `json:"body"`
	Sources  []string `json:"sources"`
	Position int      `json:"position"`
}

func knowledgeSeed() ([]knowledgeEntry, error) {
	var seed []knowledgeEntry
	err := json.Unmarshal(armoryAiKnowledgeSeed, &seed)
	return seed, err
}

func armoryAiKnowledgeUp(app core.App) error {
	knowledge := collection(m{"name": "armory_ai_knowledge", "type": "base", "fields": fields(
		m{"name": "name", "type": "text", "required": true, "max": 60, "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$", "presentable": true},
		m{"name": "kind", "type": "select", "required": true, "maxSelect": 1, "values": []string{"rule", "guide"}},
		m{"name": "title", "type": "text", "required": true, "max": 120, "presentable": true},
		m{"name": "summary", "type": "text", "max": 300},
		m{"name": "body", "type": "text", "required": true, "max": 20000},
		m{"name": "sources", "type": "text", "max": 4000},
		m{"name": "position", "type": "number", "onlyInt": true, "min": 0, "max": 9999},
		m{"name": "disabled", "type": "bool"},
		dates(),
	), "indexes": []string{
		"CREATE UNIQUE INDEX idx_armory_ai_knowledge_name ON armory_ai_knowledge (name)",
		"CREATE INDEX idx_armory_ai_knowledge_order ON armory_ai_knowledge (disabled, position)",
	}})
	if err := app.Save(knowledge); err != nil {
		return err
	}
	seed, err := knowledgeSeed()
	if err != nil {
		return err
	}
	for _, entry := range seed {
		record := core.NewRecord(knowledge)
		record.Set("name", entry.Name)
		record.Set("kind", entry.Kind)
		record.Set("title", entry.Title)
		record.Set("summary", entry.Summary)
		record.Set("body", entry.Body)
		sources := ""
		for i, s := range entry.Sources {
			if i > 0 {
				sources += "\n"
			}
			sources += s
		}
		record.Set("sources", sources)
		record.Set("position", entry.Position)
		if err := app.Save(record); err != nil {
			return err
		}
	}
	return nil
}

func armoryAiKnowledgeDown(app core.App) error {
	return deleteCollections(app, "armory_ai_knowledge")
}
