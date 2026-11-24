package odyle

import (
	"encoding/json"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// knowledgeOnly replaces the seeded knowledge base with these entries.
func knowledgeOnly(t *testing.T, app core.App, entries ...map[string]any) []*core.Record {
	t.Helper()
	if _, err := app.DB().NewQuery("DELETE FROM armory_ai_knowledge").Execute(); err != nil {
		t.Fatal(err)
	}
	out := []*core.Record{}
	for _, e := range entries {
		out = append(out, saved(t, app, "armory_ai_knowledge", e))
	}
	return out
}

// The AI follows the knowledge base's rules in every answer and reads its guides with read_guides:
// the instructions hold every rule and list every guide by name, title and summary, and leave out
// the entries switched off; read_guides answers a guide's text with its sources and says which names
// no guide has.
func TestTheAiFollowsItsKnowledgeBase(t *testing.T) {
	stand := &claudeStand{turns: []claudeTurn{
		{blocks: []map[string]any{{"type": "tool_use", "id": "toolu_1", "name": "read_guides", "input": map[string]any{"guides": []string{"enchanting", "Mounts"}}}}, stop: "tool_use"},
		{blocks: []map[string]any{{"type": "text", "text": "Stop at +10 until your stones are full."}}, stop: "end_turn"},
	}}
	stand.serve(t)
	app := newTestApp(t)
	player := newUser(t, app, "Player")
	allowAi(t, app, player)
	aiReady(t, app, body{"aiWeb": false})
	knowledgeOnly(t, app,
		map[string]any{"name": "stones-first", "kind": "rule", "title": "Stones first", "body": "Fill empty stone slots before buying enchantment levels.", "position": 1},
		map[string]any{"name": "never-enchant", "kind": "rule", "title": "Never", "body": "Never enchant anything.", "position": 2, "disabled": true},
		map[string]any{"name": "enchanting", "kind": "guide", "title": "Enchanting", "summary": "What a failed enchantment costs.", "body": "From +10 a failure drops a level.", "sources": "https://example.com/enchanting Enchanting guide\n\nhttps://example.com/notes", "position": 10},
		map[string]any{"name": "arcana", "kind": "guide", "title": "Arcana", "summary": "Sets.", "body": "Old.", "position": 11, "disabled": true},
	)
	lines := askAI(t, app, tokenOf(t, player), `{"messages":[{"role":"user","text":"How far should I enchant?"}]}`, 200)
	text, _ := aiAnswerOf(lines)
	if text != "Stop at +10 until your stones are full." || len(stand.requests) != 2 {
		t.Fatalf("answer %q after %d requests", text, len(stand.requests))
	}
	system, _ := json.Marshal(stand.requests[0]["system"])
	for _, want := range []string{"Best practices", "- Fill empty stone slots before buying enchantment levels.", "- enchanting: Enchanting. What a failed enchantment costs. (changed ", "AION 2 is not AION (2009)"} {
		if !strings.Contains(string(system), want) {
			t.Fatalf("the instructions lack %q: %s", want, system)
		}
	}
	if strings.Contains(string(system), "Never enchant") || strings.Contains(string(system), "arcana:") {
		t.Fatalf("the instructions hold an entry switched off: %s", system)
	}
	names := []string{}
	for _, tool := range stand.requests[0]["tools"].([]any) {
		names = append(names, tool.(map[string]any)["name"].(string))
	}
	if names[len(names)-1] != "read_guides" {
		t.Fatalf("tools %v", names)
	}
	messages := stand.requests[1]["messages"].([]any)
	raw, _ := json.Marshal(messages[len(messages)-1])
	read := string(raw)
	for _, want := range []string{"From +10 a failure drops a level.", "https://example.com/enchanting Enchanting guide", "https://example.com/notes", "No guide is named mounts. The guides: enchanting."} {
		if !strings.Contains(read, want) {
			t.Fatalf("read_guides answered without %q: %s", want, read)
		}
	}
	shown := false
	for _, line := range lines {
		if line["type"] == "status" && line["text"] == "Reading the guide {title}…" && line["params"].(map[string]any)["title"] == "Enchanting" {
			shown = true
		}
	}
	if !shown {
		t.Fatalf("lines %v", lines)
	}

	// Without guides there is nothing to read; without any entry the instructions say so.
	knowledgeOnly(t, app)
	askAI(t, app, tokenOf(t, player), `{"messages":[{"role":"user","text":"And now?"}]}`, 200)
	last := stand.requests[len(stand.requests)-1]
	system, _ = json.Marshal(last["system"])
	if !strings.Contains(string(system), "keeps no knowledge base") {
		t.Fatalf("system %s", system)
	}
	for _, tool := range last["tools"].([]any) {
		if tool.(map[string]any)["name"] == "read_guides" {
			t.Fatal("read_guides is offered without guides")
		}
	}
}

// read_guides refuses no name and more than it reads at once.
func TestReadGuidesReadsAFewAtOnce(t *testing.T) {
	app := newTestApp(t)
	q := &aiQuestion{app: app, out: &aiStream{gone: true}}
	if _, err := q.readGuides(nil); err == nil {
		t.Fatal("no name read")
	}
	if _, err := q.readGuides([]string{"a", "b", "c", "d", "e"}); err == nil {
		t.Fatal("five read at once")
	}
}

// Server controls show what the knowledge base holds, and what superusers change in it under
// Collections is written to the audit log.
func TestKnowledgeBaseChangesAreAudited(t *testing.T) {
	app := newTestApp(t)
	operator := newOperator(t, app)
	token, err := operator.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	admin := map[string]string{"Authorization": token}
	records := knowledgeOnly(t, app,
		map[string]any{"name": "stones-first", "kind": "rule", "title": "Stones first", "body": "Fill stones first."},
		map[string]any{"name": "enchanting", "kind": "guide", "title": "Enchanting", "body": "Text.", "disabled": true},
	)
	knowledge := ask(t, app, "GET", "/api/odyle/admin/ai", admin, "", 200)["knowledge"].(map[string]any)
	if knowledge["rules"].(float64) != 1 || knowledge["guides"].(float64) != 0 || knowledge["disabled"].(float64) != 1 || knowledge["updated"] == "" {
		t.Fatalf("knowledge %v", knowledge)
	}
	ask(t, app, "PATCH", "/api/collections/armory_ai_knowledge/records/"+records[1].Id, admin, `{"disabled":false}`, 200)
	ask(t, app, "PATCH", "/api/collections/armory_ai_knowledge/records/"+records[0].Id, admin, `{"body":"Fill every stone slot first."}`, 200)
	ask(t, app, "POST", "/api/collections/armory_ai_knowledge/records", admin, `{"name":"wings","kind":"guide","title":"Wings","body":"Text."}`, 200)
	ask(t, app, "POST", "/api/collections/armory_ai_knowledge/records", admin, `{"name":"Bad Name","kind":"guide","title":"Bad","body":"Text."}`, 400)
	deleted := tests.ApiScenario{Name: "DELETE a rule", Method: "DELETE", URL: "/api/collections/armory_ai_knowledge/records/" + records[0].Id, Headers: admin, ExpectedStatus: 204,
		TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true}
	deleted.Test(t)
	entries, err := app.FindRecordsByFilter("odyle_audit", "kind = 'ai-knowledge'", "created", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	summaries := []string{}
	for _, e := range entries {
		summaries = append(summaries, e.GetString("summary"))
	}
	want := "Switched on the AI guide Enchanting|Changed the AI best practice Stones first|Added the AI guide Wings|Deleted the AI best practice Stones first"
	if strings.Join(summaries, "|") != want {
		t.Fatalf("audit %v", summaries)
	}
	if !strings.Contains(entries[1].GetString("details"), `"changed":["body"]`) || entries[1].GetString("via") != "collections" {
		t.Fatalf("details %s", entries[1].GetString("details"))
	}
	// Players cannot read or change it.
	player := newUser(t, app, "Player")
	ask(t, app, "GET", "/api/collections/armory_ai_knowledge/records", tokenOf(t, player), "", 403)
}

// Superusers read and edit the knowledge base on the AI knowledge page: a new entry comes after the
// others of its kind, its text keeps its lines without trailing spaces, its sources one a line; a
// save that changes nothing writes no audit entry, and entries that are not sound are refused.
func TestSuperusersEditTheKnowledgeBaseOnItsPage(t *testing.T) {
	app := newTestApp(t)
	operator := newOperator(t, app)
	token, err := operator.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	admin := map[string]string{"Authorization": token}
	knowledgeOnly(t, app,
		map[string]any{"name": "stones-first", "kind": "rule", "title": "Stones first", "body": "Fill stones first.", "position": 10},
		map[string]any{"name": "enchanting", "kind": "guide", "title": "Enchanting", "summary": "Costs.", "body": "Text.", "position": 10},
	)
	list := ask(t, app, "GET", "/api/odyle/admin/ai/knowledge", admin, "", 200)
	if len(list["entries"].([]any)) != 2 || list["limits"].(map[string]any)["ruleLength"].(float64) != 600 || list["counts"].(map[string]any)["guides"].(float64) != 1 {
		t.Fatalf("list %v", list)
	}
	out := ask(t, app, "POST", "/api/odyle/admin/ai/knowledge", admin, `{"kind":"guide","title":"Wings","name":"Wings","summary":"What wings add.","body":"Line one  \r\nLine two\r\n\r\n","sources":"https://a.example/w Wings\n\n  https://b.example  "}`, 200)
	entry := out["entry"].(map[string]any)
	if entry["body"] != "Line one\nLine two" || entry["sources"] != "https://a.example/w Wings\nhttps://b.example" || entry["position"].(float64) != 20 || entry["name"] != "wings" || entry["disabled"] != false || len(out["entries"].([]any)) != 3 {
		t.Fatalf("entry %v", out)
	}
	same := `{"id":"` + entry["id"].(string) + `","kind":"guide","title":"Wings","name":"wings","summary":"What wings add.","body":"Line one\nLine two","sources":"https://a.example/w Wings\nhttps://b.example"`
	ask(t, app, "POST", "/api/odyle/admin/ai/knowledge", admin, same+`}`, 200)
	if out := ask(t, app, "POST", "/api/odyle/admin/ai/knowledge", admin, same+`,"disabled":true}`, 200); out["entry"].(map[string]any)["disabled"] != true || out["counts"].(map[string]any)["disabled"].(float64) != 1 {
		t.Fatalf("switched off %v", out)
	}
	for _, bad := range []string{
		`{"kind":"tip","title":"T","name":"t","body":"x"}`,
		`{"kind":"rule","title":" ","name":"t","body":"x"}`,
		`{"kind":"rule","title":"T","name":"Bad Name","body":"x"}`,
		`{"kind":"rule","title":"T","name":"stones-first","body":"x"}`,
		`{"kind":"guide","title":"T","name":"t","body":"x"}`,
		`{"kind":"rule","title":"T","name":"t","body":"` + strings.Repeat("a", 601) + `"}`,
		`{"kind":"rule","title":"T","name":"t","body":"  "}`,
		`{"kind":"rule","title":"T","name":"t","body":"x","position":10000}`,
	} {
		ask(t, app, "POST", "/api/odyle/admin/ai/knowledge", admin, bad, 400)
	}
	ask(t, app, "POST", "/api/odyle/admin/ai/knowledge", admin, `{"id":"nosuchentry0000","kind":"rule","title":"T","name":"t","body":"x"}`, 404)
	if out := ask(t, app, "DELETE", "/api/odyle/admin/ai/knowledge/"+entry["id"].(string), admin, "", 200); len(out["entries"].([]any)) != 2 {
		t.Fatalf("after deleting %v", out)
	}
	ask(t, app, "DELETE", "/api/odyle/admin/ai/knowledge/"+entry["id"].(string), admin, "", 404)
	audited, err := app.FindRecordsByFilter("odyle_audit", "kind = 'ai-knowledge'", "created", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	summaries := []string{}
	for _, e := range audited {
		if e.GetString("via") != "odyle" || e.GetString("actor") != operator.Id {
			t.Fatalf("entry %v", e)
		}
		summaries = append(summaries, e.GetString("summary"))
	}
	if strings.Join(summaries, "|") != "Added the AI guide Wings|Switched off the AI guide Wings|Deleted the AI guide Wings" {
		t.Fatalf("audit %v", summaries)
	}
	// Only superusers.
	player := tokenOf(t, newUser(t, app, "Player"))
	ask(t, app, "GET", "/api/odyle/admin/ai/knowledge", player, "", 403)
	ask(t, app, "POST", "/api/odyle/admin/ai/knowledge", player, `{"kind":"rule","title":"T","name":"t","body":"x"}`, 403)
}
