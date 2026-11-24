package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Who may use the armory's AI (armoryai.go), and what it took: superusers let accounts use it under
// Server controls (backend/admin), or with the armoryAi switch of an account under Collections →
// users. A change made under Server controls is written to the audit log.

const auditAiAccess = "ai-access"

// aiAccount is an account under Server controls' Armory AI: whether it may use the AI, and what it
// asked in the last 24 hours and 30 days.
type aiAccount struct {
	Id          string `db:"id" json:"id"`
	DisplayName string `db:"displayName" json:"displayName"`
	Allowed     bool   `db:"armoryAi" json:"allowed"`
	Asked24h    int    `db:"asked24h" json:"asked24h"`
	Asked30d    int    `db:"asked30d" json:"asked30d"`
	Input30d    int64  `db:"input30d" json:"inputTokens30d"`
	Output30d   int64  `db:"output30d" json:"outputTokens30d"`
	LastAt      string `db:"lastAt" json:"lastAt"`
}

// aiAccountsSelect lists accounts with what they asked; the WHERE clause comes after it.
const aiAccountsSelect = "SELECT u.id, u.displayName, u.armoryAi, " +
	"(SELECT COUNT(*) FROM armory_ai_questions q WHERE q.user = u.id AND q.created >= {:day} AND q.inputTokens > 0) AS asked24h, " +
	"(SELECT COUNT(*) FROM armory_ai_questions q WHERE q.user = u.id AND q.inputTokens > 0) AS asked30d, " +
	"(SELECT COALESCE(SUM(q.inputTokens), 0) FROM armory_ai_questions q WHERE q.user = u.id) AS input30d, " +
	"(SELECT COALESCE(SUM(q.outputTokens), 0) FROM armory_ai_questions q WHERE q.user = u.id) AS output30d, " +
	"(SELECT COALESCE(MAX(q.created), '') FROM armory_ai_questions q WHERE q.user = u.id) AS lastAt FROM users u "

func listAiAccounts(app core.App, where string, params dbx.Params) ([]aiAccount, error) {
	params["day"] = ago(aiWindow)
	out := []aiAccount{}
	if err := app.DB().NewQuery(aiAccountsSelect + where).Bind(params).All(&out); err != nil {
		return nil, err
	}
	for i := range out {
		if at, err := time.Parse(stampLayout, out[i].LastAt); err == nil {
			out[i].LastAt = isoTime(at)
		}
	}
	return out, nil
}

// aiAdminRoute answers GET /api/odyle/admin/ai: the accounts that may use the AI or asked it
// something in the last 30 days, what the AI took in that time, the models Server controls offer
// and what the knowledge base holds (aiknowledge.go). Superusers.
func aiAdminRoute(e *core.RequestEvent) error {
	accounts, err := listAiAccounts(e.App, "WHERE u.armoryAi = TRUE OR EXISTS (SELECT 1 FROM armory_ai_questions q WHERE q.user = u.id) ORDER BY u.armoryAi DESC, lower(u.displayName) LIMIT 500", dbx.Params{})
	if err != nil {
		return err
	}
	totals := struct {
		Asked24h int   `db:"asked24h" json:"asked24h"`
		Asked30d int   `db:"asked30d" json:"asked30d"`
		Input    int64 `db:"input" json:"inputTokens30d"`
		Cached   int64 `db:"cached" json:"cachedTokens30d"`
		Output   int64 `db:"output" json:"outputTokens30d"`
		Searches int64 `db:"searches" json:"webSearches30d"`
		Failed   int   `db:"failed" json:"failed30d"`
	}{}
	if err := e.App.DB().NewQuery("SELECT COUNT(CASE WHEN created >= {:day} AND inputTokens > 0 THEN 1 END) AS asked24h, COUNT(CASE WHEN inputTokens > 0 THEN 1 END) AS asked30d, " +
		"COALESCE(SUM(inputTokens), 0) AS input, COALESCE(SUM(cachedTokens), 0) AS cached, COALESCE(SUM(outputTokens), 0) AS output, COALESCE(SUM(webSearches), 0) AS searches, " +
		"COUNT(CASE WHEN ok = FALSE THEN 1 END) AS failed FROM armory_ai_questions").Bind(dbx.Params{"day": ago(aiWindow)}).One(&totals); err != nil {
		return err
	}
	knowledge, err := aiKnowledgeCounts(e.App)
	if err != nil {
		return err
	}
	return e.JSON(200, map[string]any{"accounts": accounts, "totals": totals, "models": aiModels, "knowledge": knowledge})
}

// aiAccountsRoute answers GET /api/odyle/admin/ai/accounts?q=: up to 20 accounts whose display
// name holds the text, to let one use the AI. Superusers.
func aiAccountsRoute(e *core.RequestEvent) error {
	text := trim(e.Request.URL.Query().Get("q"))
	if text == "" || length(text) > 40 {
		return e.JSON(200, map[string]any{"accounts": []aiAccount{}})
	}
	accounts, err := listAiAccounts(e.App, "WHERE u.displayName LIKE {:like} ESCAPE '\\' ORDER BY lower(u.displayName) = lower({:text}) DESC, lower(u.displayName) LIMIT 20",
		dbx.Params{"like": "%" + likeText(text) + "%", "text": text})
	if err != nil {
		return err
	}
	return e.JSON(200, map[string]any{"accounts": accounts})
}

// aiAccessRoute answers POST /api/odyle/admin/ai/access with { user, allowed }: the account may
// use the AI, or no longer. Written to the audit log with the change. Superusers.
func aiAccessRoute(e *core.RequestEvent) error {
	b, err := requestBody(e)
	if err != nil {
		return err
	}
	allowed, ok := b.boolean("allowed")
	if !ok {
		return badRequest("Say whether the account may use the AI.")
	}
	err = e.App.RunInTransaction(func(tx core.App) error {
		user, err := tx.FindRecordById("users", b.str("user"))
		if err != nil {
			return notFound("This account no longer exists.")
		}
		if user.GetBool("armoryAi") == allowed {
			return nil
		}
		user.Set("armoryAi", allowed)
		if err := tx.Save(user); err != nil {
			return err
		}
		summary := "Let " + user.GetString("displayName") + " use the armory AI"
		if !allowed {
			summary = "Stopped " + user.GetString("displayName") + " using the armory AI"
		}
		return audit(tx, e.Auth, auditAiAccess, viaOdyle, summary, map[string]any{"user": user.Id, "displayName": user.GetString("displayName"), "allowed": allowed})
	})
	if err != nil {
		return err
	}
	return aiAdminRoute(e)
}

// aiExport is what the export holds of the AI (armoryai.go): whether the account may use it, and
// each question it asked in the last 30 days, without its text, which is never kept.
func aiExport(app core.App, user *core.Record) map[string]any {
	asked := []struct {
		Created string `db:"created" json:"askedAt"`
		Model   string `db:"model" json:"model"`
		Input   int64  `db:"inputTokens" json:"inputTokens"`
		Cached  int64  `db:"cachedTokens" json:"cachedTokens"`
		Output  int64  `db:"outputTokens" json:"outputTokens"`
		Web     int64  `db:"webSearches" json:"webSearches"`
		Ok      bool   `db:"ok" json:"answered"`
	}{}
	if err := app.DB().NewQuery("SELECT created, model, inputTokens, cachedTokens, outputTokens, webSearches, ok FROM armory_ai_questions WHERE user = {:user} ORDER BY created").
		Bind(dbx.Params{"user": user.Id}).All(&asked); err != nil {
		warn(app, "Odyle could not export the armory AI's questions", "error", err.Error())
	}
	for i := range asked {
		if at, err := time.Parse(stampLayout, asked[i].Created); err == nil {
			asked[i].Created = isoTime(at)
		}
	}
	return map[string]any{"allowed": user.GetBool("armoryAi"), "questions": asked}
}
