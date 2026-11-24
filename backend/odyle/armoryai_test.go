package odyle

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

const testAiKey = "sk-ant-api03-" + "abcdefghijklmnopqrstuvwxyz0123456789-_AB12"

// claudeStand stands in for Anthropic's Messages API: each request is answered with the next of
// its turns, streamed as server-sent events, and kept for the test to read. A turn is the blocks
// of an answer (text, or a tool call with its input) and why it stopped; status, when set, fails
// every request with it.
type claudeStand struct {
	mu       sync.Mutex
	turns    []claudeTurn
	requests []map[string]any
	headers  []http.Header
	status   int
}

type claudeTurn struct {
	blocks []map[string]any
	stop   string
}

func (s *claudeStand) serve(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			w.WriteHeader(404)
			return
		}
		var request map[string]any
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &request); err != nil {
			t.Errorf("request %s: %v", raw, err)
		}
		s.mu.Lock()
		s.requests = append(s.requests, request)
		s.headers = append(s.headers, r.Header.Clone())
		status, turn := s.status, claudeTurn{blocks: []map[string]any{{"type": "text", "text": "Nothing more."}}, stop: "end_turn"}
		if len(s.turns) > 0 {
			turn, s.turns = s.turns[0], s.turns[1:]
		}
		s.mu.Unlock()
		if status != 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			fmt.Fprintf(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		event := func(name string, data map[string]any) {
			line, _ := json.Marshal(data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, line)
		}
		event("message_start", map[string]any{"type": "message_start", "message": map[string]any{"id": "msg_test", "type": "message", "role": "assistant", "model": request["model"], "content": []any{},
			"stop_reason": nil, "usage": map[string]any{"input_tokens": 100, "output_tokens": 1, "cache_creation_input_tokens": 20, "cache_read_input_tokens": 50}}})
		for i, block := range turn.blocks {
			switch block["type"] {
			case "text":
				event("content_block_start", map[string]any{"type": "content_block_start", "index": i, "content_block": map[string]any{"type": "text", "text": ""}})
				for _, word := range strings.SplitAfter(block["text"].(string), " ") {
					event("content_block_delta", map[string]any{"type": "content_block_delta", "index": i, "delta": map[string]any{"type": "text_delta", "text": word}})
				}
			case "tool_use":
				event("content_block_start", map[string]any{"type": "content_block_start", "index": i, "content_block": map[string]any{"type": "tool_use", "id": block["id"], "name": block["name"], "input": map[string]any{}}})
				input, _ := json.Marshal(block["input"])
				event("content_block_delta", map[string]any{"type": "content_block_delta", "index": i, "delta": map[string]any{"type": "input_json_delta", "partial_json": string(input)}})
			}
			event("content_block_stop", map[string]any{"type": "content_block_stop", "index": i})
		}
		event("message_delta", map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": turn.stop}, "usage": map[string]any{"output_tokens": 30}})
		event("message_stop", map[string]any{"type": "message_stop"})
	}))
	t.Cleanup(server.Close)
	t.Setenv("ODYLE_ANTHROPIC_URL", server.URL)
}

// askAI asks the AI as the account and reads the streamed answer's lines (or the error).
func askAI(t *testing.T, app *tests.TestApp, auth map[string]string, body string, status int) []map[string]any {
	t.Helper()
	lines := []map[string]any{}
	s := tests.ApiScenario{Name: "POST /api/odyle/armory/ai", Method: "POST", URL: "/api/odyle/armory/ai", Headers: auth, Body: strings.NewReader(body), ExpectedStatus: status, ExpectedContent: []string{"{"},
		TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			scanner := bufio.NewScanner(res.Body)
			for scanner.Scan() {
				var line map[string]any
				if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
					t.Fatalf("line %q: %v", scanner.Text(), err)
				}
				lines = append(lines, line)
			}
		}}
	s.Test(t)
	return lines
}

// aiAnswerOf is the text the lines streamed, with what else they said.
func aiAnswerOf(lines []map[string]any) (text string, kinds []string) {
	for _, line := range lines {
		kinds = append(kinds, line["type"].(string))
		if line["type"] == "text" {
			text += line["text"].(string)
		}
	}
	return text, kinds
}

func aiReady(t *testing.T, app core.App, values body) {
	t.Helper()
	settings := body{"aiKey": testAiKey}
	for k, v := range values {
		settings[k] = v
	}
	if _, err := writeSettings(app, settings); err != nil {
		t.Fatal(err)
	}
}

func allowAi(t *testing.T, app core.App, user *core.Record) {
	t.Helper()
	user.Set("armoryAi", true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
}

// The API key saved under Server controls is never sent back: only its end, which the audit log
// keeps too. A key that is no key is refused, "" removes it, and the model must be one offered.
func TestTheAiKeyIsKeptOutOfEveryAnswer(t *testing.T) {
	app := newTestApp(t)
	operator := newOperator(t, app)
	token, err := operator.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	auth := map[string]string{"Authorization": token}
	if s := readSettings(app); s.AiModel != "claude-opus-5-5" || s.AiQuestions != 20 || !s.AiWeb || s.AiPaused || s.AiKeyHint != "" {
		t.Fatalf("defaults %+v", s)
	}
	out := ask(t, app, "POST", "/api/odyle/admin/settings", auth, `{"aiKey":"`+testAiKey+`","aiModel":"claude-sonnet-5-5","aiQuestions":5}`, 200)
	settings := out["settings"].(map[string]any)
	if settings["aiKeyHint"] != "sk-ant-…AB12" || settings["aiModel"] != "claude-sonnet-5-5" || settings["aiQuestions"].(float64) != 5 {
		t.Fatalf("settings %v", settings)
	}
	for _, page := range []string{"/api/odyle/admin/settings", "/api/odyle/admin/audit"} {
		raw, _ := json.Marshal(ask(t, app, "GET", page, auth, "", 200))
		if strings.Contains(string(raw), "abcdefghijklmnopqrstuvwxyz") {
			t.Fatalf("%s shows the key: %s", page, raw)
		}
	}
	if readSettings(app).aiKey != testAiKey {
		t.Fatal("the key was not kept")
	}
	ask(t, app, "POST", "/api/odyle/admin/settings", auth, `{"aiKey":"sk-wrong"}`, 400)
	ask(t, app, "POST", "/api/odyle/admin/settings", auth, `{"aiModel":"gpt-5"}`, 400)
	ask(t, app, "POST", "/api/odyle/admin/settings", auth, `{"aiQuestions":0}`, 400)
	out = ask(t, app, "POST", "/api/odyle/admin/settings", auth, `{"aiKey":""}`, 200)
	if out["settings"].(map[string]any)["aiKeyHint"] != "" || readSettings(app).aiKey != "" {
		t.Fatalf("not removed: %v", out["settings"])
	}
}

// Only the accounts superusers let use the AI may, and only while it is set up and running; a
// superuser letting an account use it is written to the audit log.
func TestOnlyAllowedAccountsMayAskTheAi(t *testing.T) {
	stand := &claudeStand{}
	stand.serve(t)
	app := newTestApp(t)
	player := newUser(t, app, "Player")
	auth := tokenOf(t, player)
	question := `{"messages":[{"role":"user","text":"Who is the strongest Chanter?"}]}`
	if out := ask(t, app, "GET", "/api/odyle/armory/ai", auth, "", 200); out["allowed"] != false {
		t.Fatalf("status %v", out)
	}
	ask(t, app, "GET", "/api/odyle/armory/ai", nil, "", 401)
	ask(t, app, "POST", "/api/odyle/armory/ai", auth, question, 403)
	operator := newOperator(t, app)
	token, _ := operator.NewAuthToken()
	admin := map[string]string{"Authorization": token}
	found := ask(t, app, "GET", "/api/odyle/admin/ai/accounts?q=play", admin, "", 200)
	if accounts := found["accounts"].([]any); len(accounts) != 1 || accounts[0].(map[string]any)["id"] != player.Id || accounts[0].(map[string]any)["allowed"] != false {
		t.Fatalf("accounts %v", found)
	}
	ask(t, app, "POST", "/api/odyle/admin/ai/access", auth, `{"user":"`+player.Id+`","allowed":true}`, 403)
	out := ask(t, app, "POST", "/api/odyle/admin/ai/access", admin, `{"user":"`+player.Id+`","allowed":true}`, 200)
	if accounts := out["accounts"].([]any); len(accounts) != 1 || accounts[0].(map[string]any)["allowed"] != true {
		t.Fatalf("accounts %v", out)
	}
	if entries, err := app.FindRecordsByFilter("odyle_audit", "kind = 'ai-access'", "", 0, 0); err != nil || len(entries) != 1 || entries[0].GetString("summary") != "Let Player use the armory AI" {
		t.Fatalf("audit %v %v", entries, err)
	}
	// Allowed, but no key yet.
	if out := ask(t, app, "GET", "/api/odyle/armory/ai", auth, "", 200); out["allowed"] != true || out["ready"] != false || out["configured"] != false {
		t.Fatalf("status %v", out)
	}
	ask(t, app, "POST", "/api/odyle/armory/ai", auth, question, 503)
	aiReady(t, app, body{"aiPaused": true})
	ask(t, app, "POST", "/api/odyle/armory/ai", auth, question, 503)
	aiReady(t, app, body{"aiPaused": false})
	if out := ask(t, app, "GET", "/api/odyle/armory/ai", auth, "", 200); out["ready"] != true || out["remaining"].(float64) != 20 || out["model"] != "Claude Opus 5.5" {
		t.Fatalf("status %v", out)
	}
	if text, _ := aiAnswerOf(askAI(t, app, auth, question, 200)); text != "Nothing more." {
		t.Fatalf("answer %q", text)
	}
	ask(t, app, "POST", "/api/odyle/admin/ai/access", admin, `{"user":"`+player.Id+`","allowed":false}`, 200)
	ask(t, app, "POST", "/api/odyle/armory/ai", auth, question, 403)
	// Conversations that are none.
	allowAi(t, app, player)
	for _, bad := range []string{`{}`, `{"messages":[]}`, `{"messages":[{"role":"assistant","text":"Hi"}]}`, `{"messages":[{"role":"user","text":"Hi"},{"role":"assistant","text":"Hello"}]}`,
		`{"messages":[{"role":"user","text":"` + strings.Repeat("a", 2001) + `"}]}`, `{"messages":[{"role":"user","text":"  "}]}`} {
		ask(t, app, "POST", "/api/odyle/armory/ai", auth, bad, 400)
	}
}

// A question is answered with the armory's tools: Claude calls one, the backend runs it and
// asks again with what it found, and the answer streams to the browser as it comes. The request
// carries the key, the model, the tools and the conversation with the page's context; the
// question is counted with its tokens, never its text, and an account past its questions of 24
// hours is refused.
func TestTheAiAnswersWithTheArmorysTools(t *testing.T) {
	stand := &claudeStand{turns: []claudeTurn{
		{blocks: []map[string]any{{"type": "text", "text": "Let me look. "}, {"type": "tool_use", "id": "toolu_1", "name": "search_characters", "input": map[string]any{"query": "Kai Lumiel"}}}, stop: "tool_use"},
		{blocks: []map[string]any{{"type": "tool_use", "id": "toolu_2", "name": "get_character", "input": map[string]any{"region": "eu", "serverId": 2304, "characterId": "KaiKaiKaiKaiKaiKaiKai="}},
			{"type": "tool_use", "id": "toolu_3", "name": "top_players", "input": map[string]any{"class": "chanter", "limit": 5}}}, stop: "tool_use"},
		{blocks: []map[string]any{{"type": "text", "text": "[Kai](/armory/eu/2304/KaiKaiKaiKaiKaiKaiKai=) has **107,458 CP**."}}, stop: "end_turn"},
	}}
	stand.serve(t)
	fastArmory(t)
	plaync := &armoryStand{}
	plaync.serve(t)
	app := newTestApp(t)
	player := newUser(t, app, "Player")
	allowAi(t, app, player)
	aiReady(t, app, body{"aiQuestions": float64(2), "aiWeb": false})
	id := "KaiKaiKaiKaiKaiKaiKai="
	saved(t, app, "armory_ranks", map[string]any{"region": "eu", "serverId": 2304, "characterId": id, "name": "Kai", "class": "Chanter", "level": 45, "combatPower": 107458, "itemLevel": 1671, "checkedAt": now()})
	saved(t, app, "armory_profiles", map[string]any{"region": "eu", "serverId": 2304, "characterId": id, "name": "Kai", "fetchedAt": now(), "viewedAt": now(),
		"profile": armoryProfile{Version: armoryVersion, Name: "Kai", Level: 45, Class: "Chanter", Race: "Asmodian", Server: "Lumiel", CombatPower: 107458, ItemLevel: 1671,
			Stats:  []armoryStat{{Type: "STR", Name: "Power", Value: 120, Primary: true, Effects: []string{"Attack +2.6%"}}},
			Gear:   []armoryGear{{Slot: "MainHand", Name: "Flame Mace", Grade: "Unique", Enchant: 15, Detail: &armoryItem{ItemLevel: 160, Main: []armoryLine{{Name: "Attack", Min: "315", Value: "630", Extra: "174"}}, StoneSlots: 2, Stones: []armoryStone{{Name: "Attack", Value: "+10", Grade: "Rare"}}}}},
			Skills: []armorySkill{{Name: "Word of Wind", Category: "Active", Level: 12, Acquired: true, Equipped: true}}, Titles: armoryTitles{Owned: 40, Total: 300, Equipped: []armoryTitle{}}}})
	auth := tokenOf(t, player)
	conversation := `{"region":"GLOBAL_EU","profile":{"region":"eu","serverId":2304,"characterId":"` + id + `"},"messages":[{"role":"user","text":"Hi"},{"role":"assistant","text":"Hello! Ask me about a character."},{"role":"user","text":"How strong is Kai on Lumiel?"}]}`
	lines := askAI(t, app, auth, conversation, 200)
	text, kinds := aiAnswerOf(lines)
	if text != "Let me look. [Kai](/armory/eu/2304/"+id+") has **107,458 CP**." {
		t.Fatalf("answer %q (%v)", text, kinds)
	}
	if !strings.Contains(strings.Join(kinds, ","), "status") || kinds[len(kinds)-1] != "done" || lines[len(lines)-1]["remaining"].(float64) != 1 {
		t.Fatalf("lines %v", lines)
	}
	if len(stand.requests) != 3 {
		t.Fatalf("%d requests", len(stand.requests))
	}
	first, headers := stand.requests[0], stand.headers[0]
	if headers.Get("Authorization") != "Bearer "+testAiKey || first["model"] != "claude-opus-5-5" || first["fallbacks"] != "default" || first["stream"] != true {
		t.Fatalf("request %v %v", first, headers)
	}
	if !strings.Contains(strings.Join(headers.Values("Anthropic-Beta"), ","), "server-side-fallback-2026-07-01") {
		t.Fatalf("headers %v", headers)
	}
	if effort := first["output_config"].(map[string]any)["effort"]; effort != "high" || first["cache_control"] == nil {
		t.Fatalf("request %v", first)
	}
	system, _ := json.Marshal(first["system"])
	if !strings.Contains(string(system), "Lumiel") || !strings.Contains(string(system), "cannot search the web") || !strings.Contains(string(system), "How to plan upgrades") {
		t.Fatalf("system %s", system)
	}
	names := []string{}
	for _, tool := range first["tools"].([]any) {
		names = append(names, tool.(map[string]any)["name"].(string))
	}
	// read_guides too: the knowledge base starts with guides.
	if strings.Join(names, ",") != "my_characters,search_characters,get_character,top_players,compare_with_class,read_guides" {
		t.Fatalf("tools %v", names)
	}
	messages := first["messages"].([]any)
	opening, _ := json.Marshal(messages[0])
	if len(messages) != 3 || !strings.Contains(string(opening), "path /armory/eu/2304/"+id) || !strings.Contains(string(opening), "region code eu") {
		t.Fatalf("messages %s", opening)
	}
	// What the tools answered, in the next requests.
	results := func(n int) string {
		messages := stand.requests[n]["messages"].([]any)
		raw, _ := json.Marshal(messages[len(messages)-1])
		return string(raw)
	}
	// Kai, whom the armory knows, then those PLAYNC's search found on Lumiel.
	if found := results(1); !strings.Contains(found, `\"path\":\"/armory/eu/2304/`+id) || !strings.Contains(found, `knownToOdyle\":true`) || !strings.Contains(found, `foundOnPlaync\":true`) || !strings.Contains(found, "PLAYNC's search was asked in Europe") || plaync.searches.Load() != 1 {
		t.Fatalf("search answered %s", found)
	}
	read := results(2)
	if !strings.Contains(read, "Flame Mace") || !strings.Contains(read, `Attack 315 ~ 630 (+174)`) || !strings.Contains(read, "Word of Wind Lv 12 (Active)") || !strings.Contains(read, `\"place\":1`) {
		t.Fatalf("tools answered %s", read)
	}
	question, err := app.FindFirstRecordByFilter("armory_ai_questions", "user = {:user}", map[string]any{"user": player.Id})
	if err != nil || question.GetInt("inputTokens") != 3*170 || question.GetInt("cachedTokens") != 150 || question.GetInt("outputTokens") != 90 || !question.GetBool("ok") || question.GetString("model") != "claude-opus-5-5" {
		t.Fatalf("question %v %v", question, err)
	}
	// The second question is the last one of the 24 hours.
	askAI(t, app, auth, `{"messages":[{"role":"user","text":"Thanks"}]}`, 200)
	ask(t, app, "POST", "/api/odyle/armory/ai", auth, `{"messages":[{"role":"user","text":"One more"}]}`, 400)
	if out := ask(t, app, "GET", "/api/odyle/armory/ai", auth, "", 200); out["remaining"].(float64) != 0 || out["freeAt"] == "" {
		t.Fatalf("status %v", out)
	}
	// The export holds the questions, never their text.
	export := ask(t, app, "GET", "/api/odyle/export", auth, "", 200)["armoryAi"].(map[string]any)
	raw, _ := json.Marshal(export)
	if export["allowed"] != true || len(export["questions"].([]any)) != 2 || strings.Contains(string(raw), "Kai") || !strings.Contains(string(raw), `"inputTokens":510`) {
		t.Fatalf("export %s", raw)
	}
}

// A key Anthropic refuses ends the answer with words the player can pass on; the question took no
// tokens, so it does not count.
func TestARefusedKeyEndsTheAnswerWithoutCountingIt(t *testing.T) {
	stand := &claudeStand{status: 401}
	stand.serve(t)
	app := newTestApp(t)
	player := newUser(t, app, "Player")
	allowAi(t, app, player)
	aiReady(t, app, body{"aiModel": "claude-haiku-5-5"})
	lines := askAI(t, app, tokenOf(t, player), `{"messages":[{"role":"user","text":"Hi"}]}`, 200)
	last := lines[len(lines)-1]
	if last["type"] != "error" || last["message"] != "The AI service refused this server's API key. Tell the server's operator." {
		t.Fatalf("lines %v", lines)
	}
	if n := countOf(t, app, "armory_ai_questions"); n != 0 {
		t.Fatalf("%d questions counted", n)
	}
	// Haiku has no server-side fallback.
	if len(stand.requests) == 0 || stand.requests[0]["fallbacks"] != nil {
		t.Fatalf("requests %v", stand.requests)
	}
}

// "My character" is one of the account's own: the AI lists them, the main one first, with their
// armory ids once Odyle found them on PLAYNC and what the armory knows of them; nobody else's.
func TestTheAiKnowsTheAccountsOwnCharacters(t *testing.T) {
	stand := &claudeStand{turns: []claudeTurn{
		{blocks: []map[string]any{{"type": "tool_use", "id": "toolu_1", "name": "my_characters", "input": map[string]any{}}}, stop: "tool_use"},
		{blocks: []map[string]any{{"type": "text", "text": "Your main is Kai."}}, stop: "end_turn"},
	}}
	stand.serve(t)
	app := newTestApp(t)
	player, other := newUser(t, app, "Player"), newUser(t, app, "Other")
	allowAi(t, app, player)
	aiReady(t, app, nil)
	id := "KaiKaiKaiKaiKaiKaiKai="
	saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Alt", "server": "Siel", "region": "GLOBAL_EU", "className": "Cleric", "level": 30})
	saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Kai", "server": "Lumiel", "region": "GLOBAL_EU", "className": "Chanter", "level": 45, "main": true,
		"officialId": id, "officialRegion": "eu", "officialServerId": 2304})
	saved(t, app, "characters", map[string]any{"user": other.Id, "characterName": "Stranger", "server": "Lumiel", "region": "GLOBAL_EU"})
	saved(t, app, "armory_ranks", map[string]any{"region": "eu", "serverId": 2304, "characterId": id, "name": "Kai", "class": "Chanter", "level": 45, "combatPower": 107458, "itemLevel": 1671, "checkedAt": now()})
	text, _ := aiAnswerOf(askAI(t, app, tokenOf(t, player), `{"messages":[{"role":"user","text":"What should I upgrade?"}]}`, 200))
	if text != "Your main is Kai." || len(stand.requests) != 2 {
		t.Fatalf("answer %q after %d requests", text, len(stand.requests))
	}
	messages := stand.requests[1]["messages"].([]any)
	raw, _ := json.Marshal(messages[len(messages)-1])
	found := string(raw)
	kai, alt := strings.Index(found, `\"name\":\"Kai\"`), strings.Index(found, `\"name\":\"Alt\"`)
	if kai < 0 || alt < kai || !strings.Contains(found, `\"path\":\"/armory/eu/2304/`+id) || !strings.Contains(found, `\"combatPower\":107458`) || strings.Contains(found, "Stranger") ||
		!strings.Contains(found, "were not found on PLAYNC yet") {
		t.Fatalf("my characters %s", found)
	}
}
