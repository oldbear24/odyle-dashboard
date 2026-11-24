package odyle

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory's AI (/armory/ai, src/armoryai.js): signed-in players a superuser lets use it ask, in
// their own words, how to upgrade their characters' gear (and about AION 2 Global characters at
// all), and Anthropic's Claude answers them with the armory's own data: it knows the account's own
// characters, finds characters (armoryfind.go), reads the profiles the armory keeps or looks them
// up at PLAYNC (armory.go), lists the strongest of a class (ranks.go) and compares a character with
// the stronger characters of its class as the Upgrade tab does (upgrades.go), and, when Server
// controls allow it, searches the web (armoryaitools.go). It follows the best practices of the
// server's knowledge base of AION 2's gear and reads its guides (aiknowledge.go). A superuser saves the Anthropic API key, the model and how many
// questions an account may ask in 24 hours under Server controls (settings.go), and lets accounts
// use it (users.armoryAi, aiaccess.go).
//
// The browser keeps the conversation (as text) and sends it with each question; the backend keeps
// only that a question was asked, by whom, with which model and how many tokens it took
// (armory_ai_questions), never its text or the answer. What is sent to Anthropic is the
// conversation and what the tools read, which is public (PLAYNC's pages, the armory's lists).

// aiModelInfo is a Claude model the AI may ask, as Server controls offer it. fallback: Anthropic
// answers a request it declines on that model with another one (server-side fallbacks).
type aiModelInfo struct {
	Id       string `json:"id"`
	Name     string `json:"name"`
	fallback bool
}

var aiModels = []aiModelInfo{
	{Id: "claude-opus-5-5", Name: "Claude Opus 5.5", fallback: true},
	{Id: "claude-sonnet-5-5", Name: "Claude Sonnet 5.5", fallback: true},
	{Id: "claude-haiku-5-5", Name: "Claude Haiku 5.5"},
}

// aiModelOf is the model offered under that id, or nil.
func aiModelOf(id string) *aiModelInfo {
	for i := range aiModels {
		if aiModels[i].Id == id {
			return &aiModels[i]
		}
	}
	return nil
}

const (
	defaultAiModel                     = "claude-opus-5-5"
	defaultAiQuestions, maxAiQuestions = 20, 500
	aiWindow                           = 24 * time.Hour      // an account's questions are counted over this long
	aiKeep                             = 30 * 24 * time.Hour // a question's row is kept this long
	aiTurns                            = 20                  // the most messages of a conversation sent with a question
	aiQuestionLength                   = 2000                // a question's characters
	aiAnswerLength                     = 12000               // an earlier answer's characters
	aiConversationLength               = 60000               // all of the conversation's characters
	aiRounds                           = 8                   // requests to Claude for one question
	aiInputBudget                      = 600000              // input tokens a question may take before it stops asking
	aiAtOnce                           = 4                   // questions answered at once, server-wide
	aiTimeout                          = 4 * time.Minute     // a question's answer, within the server's write timeout
	aiMaxTokens                        = 32000
)

// aiKeyPattern is what an Anthropic API key looks like.
var aiKeyPattern = regexp.MustCompile(`^sk-ant-[A-Za-z0-9_-]{20,250}$`)

// aiKeyHint is the end of a key, as Server controls and the audit log show it, or "" for none.
func aiKeyHint(key string) string {
	if key == "" {
		return ""
	}
	return "sk-ant-…" + key[len(key)-4:]
}

// aiURL is where Claude is asked: Anthropic's API, unless tests point the AI at a stand-in.
func aiURL() string { return os.Getenv("ODYLE_ANTHROPIC_URL") }

// aiAllowed reports whether a signed-in account may use the AI: a superuser let it.
func aiAllowed(auth *core.Record) bool {
	return auth != nil && auth.Collection().Name == "users" && auth.GetBool("armoryAi")
}

// aiWork keeps the questions being answered: one at a time for each account, aiAtOnce in all.
type aiWork struct {
	mu     sync.Mutex
	asking map[string]bool
}

func newAiWork() *aiWork { return &aiWork{asking: map[string]bool{}} }

func (w *aiWork) begin(user string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.asking[user] {
		return badRequest("The AI is still answering your last question. Wait for its answer.")
	}
	if len(w.asking) >= aiAtOnce {
		return unavailable("The AI is answering many questions at the moment. Try again in a minute.")
	}
	w.asking[user] = true
	return nil
}

func (w *aiWork) end(user string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.asking, user)
}

// aiUsage is how many questions an account asked in the last aiWindow that took tokens, and, once
// that is limit or more, when the next one may be asked ("" before).
func aiUsage(app core.App, user string, limit int64) (int, string, error) {
	asked := []string{}
	if err := app.DB().NewQuery("SELECT created FROM armory_ai_questions WHERE user = {:user} AND created >= {:since} AND inputTokens > 0 ORDER BY created").
		Bind(dbx.Params{"user": user, "since": ago(aiWindow)}).Column(&asked); err != nil {
		return 0, "", err
	}
	used, freeAt := len(asked), ""
	if int64(used) >= limit && limit > 0 {
		if at, err := time.Parse(stampLayout, asked[used-int(limit)]); err == nil {
			freeAt = isoTime(at.Add(aiWindow))
		}
	}
	return used, freeAt, nil
}

// aiStatusRoute answers GET /api/odyle/armory/ai: whether the signed-in account may use the AI,
// whether it is set up and running, and how many of its questions the account has left. Signed in.
func aiStatusRoute(e *core.RequestEvent) error {
	if !aiAllowed(e.Auth) {
		return e.JSON(200, map[string]any{"allowed": false})
	}
	s := readSettings(e.App)
	used, freeAt, err := aiUsage(e.App, e.Auth.Id, s.AiQuestions)
	if err != nil {
		return err
	}
	return e.JSON(200, map[string]any{"allowed": true, "ready": s.aiKey != "" && !s.AiPaused, "configured": s.aiKey != "", "paused": s.AiPaused,
		"limit": s.AiQuestions, "used": used, "remaining": max(0, int(s.AiQuestions)-used), "freeAt": freeAt, "web": s.AiWeb, "model": aiModelOf(s.AiModel).Name})
}

// aiTurn is one message of a conversation, as the browser sends it.
type aiTurn struct {
	role, text string
}

// aiConversation reads a question's conversation: 1 to aiTurns messages, the account's and the
// AI's in turn, starting and ending with the account's; a question is 1 to aiQuestionLength
// characters, an earlier answer up to aiAnswerLength, all of it up to aiConversationLength.
func aiConversation(b body) ([]aiTurn, error) {
	raw, ok := b["messages"].([]any)
	if !ok || len(raw) == 0 || len(raw) > aiTurns || len(raw)%2 == 0 {
		return nil, badRequest("Send the conversation as messages, yours and the AI's in turn, ending with your question.")
	}
	out, total := []aiTurn{}, 0
	for i, item := range raw {
		entry, _ := item.(map[string]any)
		role, _ := entry["role"].(string)
		text, _ := entry["text"].(string)
		text = trim(text)
		want, limit := "user", aiQuestionLength
		if i%2 == 1 {
			want, limit = "assistant", aiAnswerLength
		}
		if role != want {
			return nil, badRequest("Send the conversation as messages, yours and the AI's in turn, ending with your question.")
		}
		if text == "" || length(text) > limit {
			if want == "user" {
				return nil, badRequest("Ask a question of up to 2,000 characters.")
			}
			return nil, badRequest("An earlier answer of the conversation is too long. Start a new conversation.")
		}
		total += length(text)
		out = append(out, aiTurn{role: role, text: text})
	}
	if total > aiConversationLength {
		return nil, badRequest("The conversation is too long. Start a new conversation.")
	}
	return out, nil
}

// aiFocus is what the page the question was asked from tells the AI: the profile it was opened
// from (its path, when the armory keeps it) and the region last chosen in the armory's search.
type aiFocus struct {
	profile     string // "/armory/eu/2304/…", or ""
	name        string
	region      string // an Odyle region, or ""
	serverId    int
	characterId string
	code        string // the profile's search region
}

func readFocus(app core.App, b body) aiFocus {
	var f aiFocus
	if region, _ := b.text("region"); knownRegion(region) {
		f.region = region
	}
	p, _ := b["profile"].(map[string]any)
	code, _ := p["region"].(string)
	id, _ := p["characterId"].(string)
	serverId := int(number(p["serverId"]))
	if serversOf(app).inRegion(code, serverId) == "" || !armoryIds.MatchString(id) {
		return f
	}
	f.code, f.serverId, f.characterId = code, serverId, id
	f.profile = "/armory/" + code + "/" + strconv.Itoa(serverId) + "/" + id
	if record, err := keptProfile(app, serverId, id); err == nil && record != nil && !record.GetBool("hidden") {
		f.name = record.GetString("name")
	}
	return f
}

// note is what the focus tells the AI, before the conversation's first question.
func (f aiFocus) note(book serverBook) string {
	lines := []string{}
	if f.profile != "" {
		who := "a character"
		if f.name != "" {
			who = f.name
		}
		lines = append(lines, "The user opened this conversation from the profile of "+who+" on "+book.name(f.serverId)+" (region "+f.code+", serverId "+strconv.Itoa(f.serverId)+", characterId "+f.characterId+", path "+f.profile+"). \"This character\" means it, and so does a question about upgrades that names no other.")
	}
	if r := regionNamed(f.region); r.digit != 0 {
		lines = append(lines, "The region last chosen in the armory's search: "+r.title+" (region code "+r.code+"). Search there when the user names no region.")
	}
	if len(lines) == 0 {
		return ""
	}
	return "[Context from the page, not written by the user]\n" + strings.Join(lines, "\n")
}

// aiStream writes a question's answer to the browser as it comes, one JSON object a line.
type aiStream struct {
	mu   sync.Mutex
	e    *core.RequestEvent
	gone bool
}

func (s *aiStream) send(v map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gone {
		return
	}
	line, err := json.Marshal(v)
	if err != nil {
		return
	}
	if _, err := s.e.Response.Write(append(line, '\n')); err != nil {
		s.gone = true
		return
	}
	_ = s.e.Flush()
}

// status tells the reader what the AI is doing: an English text the dashboard translates, with
// the values its {placeholders} take.
func (s *aiStream) status(text string, params map[string]any) {
	s.send(map[string]any{"type": "status", "text": text, "params": params})
}

// aiAskRoute answers POST /api/odyle/armory/ai with { messages: [{ role, text }], profile?: {
// region, serverId, characterId }, region? }: Claude's answer to the conversation's last question,
// streamed as it comes (application/x-ndjson): { type: "status", text, params } while it looks
// something up,
// { type: "text", text } for each piece of the answer, { type: "break" } between the answer's
// parts, { type: "sources", sources: [{ url, title }] } for the web pages it cites, then { type:
// "done", remaining } or { type: "error", message }. Signed in; the account must be allowed, the AI
// set up and running and the account within its questions of 24 hours.
func aiAskRoute(e *core.RequestEvent) error {
	if !aiAllowed(e.Auth) {
		return forbidden("Your account may not use the armory AI. Ask the server's operator.")
	}
	s := readSettings(e.App)
	if s.aiKey == "" {
		return unavailable("The armory AI is not set up on this server.")
	}
	if s.AiPaused {
		return unavailable("The armory AI is paused for now. Try again later.")
	}
	b, err := requestBody(e)
	if err != nil {
		return err
	}
	conversation, err := aiConversation(b)
	if err != nil {
		return err
	}
	used, _, err := aiUsage(e.App, e.Auth.Id, s.AiQuestions)
	if err != nil {
		return err
	}
	if int64(used) >= s.AiQuestions {
		return badRequest("You asked the AI as many questions as you may in 24 hours. Try again later.")
	}
	work := stateOf(e.App).ai
	if err := work.begin(e.Auth.Id); err != nil {
		return err
	}
	defer work.end(e.Auth.Id)
	focus := readFocus(e.App, b)

	headers := e.Response.Header()
	headers.Set("Content-Type", "application/x-ndjson; charset=utf-8")
	headers.Set("Cache-Control", "no-store")
	headers.Set("X-Accel-Buffering", "no")
	e.Response.WriteHeader(http.StatusOK)
	out := &aiStream{e: e}
	out.status("Thinking…", nil)

	ctx, cancel := context.WithTimeout(e.Request.Context(), aiTimeout)
	defer cancel()
	q := &aiQuestion{app: e.App, user: e.Auth.Id, settings: s, model: aiModelOf(s.AiModel), out: out, focus: focus}
	answerErr := q.ask(ctx, conversation)
	// The question counts once it took tokens, answered or not.
	if q.input > 0 || answerErr == nil {
		if saveErr := q.keep(answerErr); saveErr != nil {
			warn(e.App, "Odyle could not count an armory AI question", "error", message(saveErr))
		}
	}
	if answerErr != nil {
		if !errors.Is(answerErr, context.Canceled) {
			out.send(map[string]any{"type": "error", "message": aiFailure(e.App, answerErr)})
		}
		return nil
	}
	if len(q.sources) > 0 {
		out.send(map[string]any{"type": "sources", "sources": q.sources})
	}
	used, freeAt, _ := aiUsage(e.App, e.Auth.Id, s.AiQuestions)
	out.send(map[string]any{"type": "done", "remaining": max(0, int(s.AiQuestions)-used), "freeAt": freeAt})
	return nil
}

// aiFailure says in words why a question got no answer; what the players cannot fix is logged.
func aiFailure(app core.App, err error) string {
	var refused aiRefusal
	if errors.As(err, &refused) {
		return "The AI declined to answer this question. Ask it differently."
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "The answer took too long. Ask a narrower question."
	}
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case 401, 403:
			warn(app, "Anthropic refused the armory AI's API key", "status", apiErr.StatusCode)
			return "The AI service refused this server's API key. Tell the server's operator."
		case 429:
			return "The AI service is busy. Try again in a minute."
		case 500, 502, 503, 504, 529:
			return "The AI service is overloaded. Try again in a minute."
		}
		warn(app, "The armory AI's request failed", "status", apiErr.StatusCode, "error", cut(apiErr.Error(), 300))
		return "The AI could not answer this question. Try again later."
	}
	warn(app, "The armory AI could not reach Anthropic", "error", message(err))
	return "The AI service did not answer. Try again in a minute."
}

// aiRefusal is a question Claude declined to answer.
type aiRefusal struct{}

func (aiRefusal) Error() string { return "the AI declined" }

// aiQuestion is a question being answered, with what it took.
type aiQuestion struct {
	app      core.App
	user     string
	settings settings
	model    *aiModelInfo
	out      *aiStream
	focus    aiFocus
	// What the answer took, summed over its requests.
	input, cached, output, searches int64
	sources                         []map[string]string
}

// keep counts the question (armory_ai_questions).
func (q *aiQuestion) keep(failure error) error {
	collection, err := q.app.FindCachedCollectionByNameOrId("armory_ai_questions")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("user", q.user)
	record.Set("model", q.model.Id)
	record.Set("inputTokens", q.input)
	record.Set("cachedTokens", q.cached)
	record.Set("outputTokens", q.output)
	record.Set("webSearches", q.searches)
	record.Set("ok", failure == nil)
	if failure != nil {
		record.Set("error", cut(message(failure), 300))
	}
	return q.app.Save(record)
}

// client is the Anthropic client of the key saved under Server controls, and nothing from the
// server's environment.
func (q *aiQuestion) client() anthropic.Client {
	opts := []option.RequestOption{option.WithoutEnvironmentDefaults(), option.WithAPIKey(q.settings.aiKey), option.WithMaxRetries(2)}
	if url := aiURL(); url != "" {
		opts = append(opts, option.WithBaseURL(url))
	}
	return anthropic.NewClient(opts...)
}

// messages are the conversation as Claude reads it, the page's context before the first question.
func (q *aiQuestion) messages(conversation []aiTurn) []anthropic.BetaMessageParam {
	out := []anthropic.BetaMessageParam{}
	for i, turn := range conversation {
		if turn.role == "assistant" {
			out = append(out, anthropic.BetaMessageParam{OfAssistant: &anthropic.BetaAssistantMessageParam{Content: []anthropic.BetaContentBlockParamUnion{anthropic.NewBetaTextBlock(turn.text)}}})
			continue
		}
		blocks := []anthropic.BetaContentBlockParamUnion{}
		if note := q.focus.note(serversOf(q.app)); i == 0 && note != "" {
			blocks = append(blocks, anthropic.NewBetaTextBlock(note))
		}
		out = append(out, anthropic.NewBetaUserMessage(append(blocks, anthropic.NewBetaTextBlock(turn.text))...))
	}
	return out
}

// ask answers the conversation's last question: it asks Claude, runs the tools it calls and asks
// again with what they found, until it answers (at most aiRounds requests, the last without tools),
// streaming the answer's text as it comes.
func (q *aiQuestion) ask(ctx context.Context, conversation []aiTurn) error {
	client := q.client()
	rules, guides, err := aiKnowledge(q.app)
	if err != nil {
		// The armory's data still answers, without the knowledge base.
		warn(q.app, "The armory AI could not read its knowledge base", "error", message(err))
		rules, guides = nil, nil
	}
	params := anthropic.BetaMessageNewParams{
		Model:     q.model.Id,
		MaxTokens: aiMaxTokens,
		System:    []anthropic.BetaTextBlockParam{{Text: aiInstructions(q.app, q.settings, rules, guides)}},
		Messages:  q.messages(conversation),
		Tools:     aiTools(q.settings.AiWeb, len(guides) > 0),
		// An upgrade plan weighs many slots against the stronger players of the class: high effort.
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffortHigh},
		// The instructions, tools and conversation so far are cached for the next request.
		CacheControl: anthropic.NewBetaCacheControlEphemeralParam(),
	}
	if q.model.fallback {
		params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
		params.Fallbacks = anthropic.BetaFallbacksParamOfDefault()
	}
	wrote := false
	for round := 0; round < aiRounds; round++ {
		if round == aiRounds-1 || q.input > aiInputBudget {
			params.ToolChoice = anthropic.BetaToolChoiceUnionParam{OfNone: &anthropic.BetaToolChoiceNoneParam{}}
		}
		if wrote {
			q.out.send(map[string]any{"type": "break"})
		}
		answer, streamed, err := q.request(ctx, client, params)
		wrote = wrote || streamed
		if err != nil {
			return err
		}
		params.Messages = append(params.Messages, answer.ToParam())
		switch answer.StopReason {
		case anthropic.BetaStopReasonToolUse:
			params.Messages = append(params.Messages, anthropic.NewBetaUserMessage(q.runTools(ctx, answer.Content)...))
		case anthropic.BetaStopReasonPauseTurn:
			// The web search paused a long turn: asked again, it goes on.
		case anthropic.BetaStopReasonRefusal:
			return aiRefusal{}
		default:
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	return nil
}

// request asks Claude once, streaming the text of its answer to the browser, and says what it
// answered and whether it wrote any text.
func (q *aiQuestion) request(ctx context.Context, client anthropic.Client, params anthropic.BetaMessageNewParams) (anthropic.BetaMessage, bool, error) {
	stream := client.Beta.Messages.NewStreaming(ctx, params)
	defer stream.Close()
	var answer anthropic.BetaMessage
	wrote := false
	for stream.Next() {
		event := stream.Current()
		if err := answer.Accumulate(event); err != nil {
			return answer, wrote, err
		}
		switch event.Type {
		case "content_block_start":
			if event.ContentBlock.Type == "server_tool_use" {
				switch event.ContentBlock.Name {
				case "web_search":
					q.out.status("Searching the web…", nil)
				case "web_fetch":
					q.out.status("Reading a web page…", nil)
				}
			}
		case "content_block_delta":
			if event.Delta.Type == "text_delta" && event.Delta.Text != "" {
				q.out.send(map[string]any{"type": "text", "text": event.Delta.Text})
				wrote = true
			}
		}
	}
	u := answer.Usage
	q.input += u.InputTokens + u.CacheCreationInputTokens + u.CacheReadInputTokens
	q.cached += u.CacheReadInputTokens
	q.output += u.OutputTokens
	q.searches += u.ServerToolUse.WebSearchRequests
	q.cite(answer.Content)
	return answer, wrote, stream.Err()
}

// cite keeps the web pages the answer cites, each once, up to 12.
func (q *aiQuestion) cite(content []anthropic.BetaContentBlockUnion) {
	for _, block := range content {
		if block.Type != "text" {
			continue
		}
		for _, c := range block.Citations {
			if c.URL == "" || !strings.HasPrefix(c.URL, "https://") && !strings.HasPrefix(c.URL, "http://") || len(q.sources) >= 12 {
				continue
			}
			known := false
			for _, s := range q.sources {
				known = known || s["url"] == c.URL
			}
			if !known {
				q.sources = append(q.sources, map[string]string{"url": cut(c.URL, 500), "title": cut(collapse(c.Title), 200)})
			}
		}
	}
}

// runTools runs the tools an answer called, at once, and answers what each found, in their order.
func (q *aiQuestion) runTools(ctx context.Context, content []anthropic.BetaContentBlockUnion) []anthropic.BetaContentBlockParamUnion {
	calls := []anthropic.BetaContentBlockUnion{}
	for _, block := range content {
		if block.Type == "tool_use" {
			calls = append(calls, block)
		}
	}
	results := make([]anthropic.BetaContentBlockParamUnion, len(calls))
	var wg sync.WaitGroup
	for i, call := range calls {
		wg.Add(1)
		go func() {
			defer wg.Done()
			text, err := q.runTool(ctx, call.Name, call.Input)
			if err != nil {
				results[i] = anthropic.NewBetaToolResultBlock(call.ID, message(err), true)
				return
			}
			results[i] = anthropic.NewBetaToolResultBlock(call.ID, text, false)
		}()
	}
	wg.Wait()
	return results
}
