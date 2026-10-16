package odyle

import (
	"strconv"
	"testing"
)

func TestChecklistsPerCharacterAndTheGlobalList(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	user, other := newUser(t, app, "Tasker"), newUser(t, app, "Other")
	alt := newGameCharacter(t, app, user.Id, "Alt")
	foreign := newGameCharacter(t, app, other.Id, "Foreign")
	token := tokenOf(t, user)
	post := func(body string, status int) map[string]any {
		t.Helper()
		return ask(t, app, "POST", "/api/odyle/task", token, body, status)
	}
	type row struct{ title, cadence, character, name string }
	rows := func(answer map[string]any) []row {
		out := []row{}
		for _, v := range answer["tasks"].([]any) {
			task := v.(map[string]any)
			out = append(out, row{task["title"].(string), task["cadence"].(string), task["character"].(string), task["characterName"].(string)})
		}
		return out
	}
	// The account's list and a character's list.
	post(`{"title":"Daily dungeon","cadence":"daily"}`, 200)
	answer := post(`{"title":"Daily dungeon","cadence":"daily","characterId":"`+alt+`"}`, 200)
	if got := rows(answer); len(got) != 2 || got[0] != (row{"Daily dungeon", "daily", "", ""}) || got[1] != (row{"Daily dungeon", "daily", alt, "Alt"}) {
		t.Fatalf("tasks %v", got)
	}
	if characters := answer["characters"].([]any); len(characters) != 1 || characters[0].(map[string]any)["characterName"] != "Alt" || answer["limit"].(float64) != 40 || len(answer["templates"].([]any)) != 0 {
		t.Fatalf("answer %v", answer)
	}
	// Another account's character is not a list of this one.
	post(`{"title":"Theirs","cadence":"daily","characterId":"`+foreign+`"}`, 403)
	// Moving stays within a list: the account's second daily goes above its first, not the alt's.
	second := post(`{"title":"Second","cadence":"daily"}`, 200)
	var secondId string
	for _, v := range second["tasks"].([]any) {
		if task := v.(map[string]any); task["title"] == "Second" {
			secondId = task["id"].(string)
		}
	}
	moved := []row{}
	for _, r := range rows(post(`{"id":"`+secondId+`","move":"up"}`, 200)) {
		if r.character == "" {
			moved = append(moved, r)
		}
	}
	if len(moved) != 2 || moved[0].title != "Second" || moved[1] != (row{"Daily dungeon", "daily", "", ""}) {
		t.Fatalf("moved %v", moved)
	}
	// Each list keeps up to 40 tasks; a character's list has its own room.
	for i := 3; i <= taskLimit; i++ {
		post(`{"title":"Task `+strconv.Itoa(i)+`","cadence":"daily"}`, 200)
	}
	if refused := post(`{"title":"One too many","cadence":"daily"}`, 400); refused["message"] != "Each list keeps up to 40 tasks." {
		t.Fatalf("refused %v", refused)
	}
	post(`{"title":"Alt weekly","cadence":"weekly","characterId":"`+alt+`"}`, 200)
	// The Global list: added to one list in one go, without what the list has already.
	if _, err := writeSettings(app, body{"taskTemplates": []any{map[string]any{"title": " Nightmare ", "cadence": "weekly"}, map[string]any{"title": "Daily dungeon", "cadence": "daily"}}}); err != nil {
		t.Fatal(err)
	}
	if templates := readSettings(app).TaskTemplates; len(templates) != 2 || templates[0] != (taskTemplate{"Nightmare", "weekly"}) {
		t.Fatalf("templates %v", templates)
	}
	before := len(rows(post(`{"id":"`+secondId+`","done":true}`, 200)))
	added := rows(post(`{"templates":["nightmare","DAILY DUNGEON"],"characterId":"`+alt+`"}`, 200))
	nightmare := 0
	for _, r := range added {
		if r == (row{"Nightmare", "weekly", alt, "Alt"}) {
			nightmare++
		}
	}
	if len(added) != before+1 || nightmare != 1 {
		t.Fatalf("added %v", added)
	}
	if again := rows(post(`{"templates":["Nightmare"],"characterId":"`+alt+`"}`, 200)); len(again) != len(added) {
		t.Fatal("a task the list has is not added again")
	}
	post(`{"templates":["Not on the list"]}`, 400)
	post(`{"templates":[]}`, 400)
	for _, bad := range []any{"Nightmare", []any{map[string]any{"title": "A", "cadence": "monthly"}}, []any{map[string]any{"title": "A", "cadence": "daily"}, map[string]any{"title": "a", "cadence": "weekly"}}} {
		if _, err := writeSettings(app, body{"taskTemplates": bad}); err == nil {
			t.Fatalf("saved %v", bad)
		}
	}
	// A character deleted from the account takes its list along.
	record, _ := app.FindRecordById("characters", alt)
	if err := app.Delete(record); err != nil {
		t.Fatal(err)
	}
	for _, r := range rows(ask(t, app, "GET", "/api/odyle/tasks", token, "", 200)) {
		if r.character != "" {
			t.Fatalf("left over %v", r)
		}
	}
}
