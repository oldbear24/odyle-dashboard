package odyle

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The armory AI's knowledge base (armory_ai_knowledge, migration 1791763290): how AION 2's gear
// works and what pays off. Superusers read and edit it on the Odyle pages' AI knowledge page
// (backend/admin, the routes below), or under Collections → armory_ai_knowledge. Odyle seeds it
// with researched entries; superusers correct them as patches change the game, add their own or
// switch one off.
//
// Each entry is a rule (shown to superusers as a best practice) or a guide. Every rule (a sentence
// or two) goes into the AI's instructions, so it follows them in every answer. The guides (the
// mechanics at length: enchanting, stones, arcana, …) are listed there by name, title and summary,
// and the AI reads those a question needs with read_guides. Entries switched off (disabled) are left
// out. A change to the knowledge base changes the instructions, so the next question reads them
// anew rather than from Anthropic's cache.
//
// What superusers change, on the page or under Collections, is written to the audit log.

const (
	auditAiKnowledge   = "ai-knowledge"
	aiRules            = 40    // the most rules the instructions hold
	aiRuleLength       = 600   // a rule's characters
	aiGuidesListed     = 80    // the most guides the instructions list
	aiGuidesRead       = 4     // guides one read_guides call reads
	aiGuideLength      = 20000 // a guide's characters, as the collection allows
	aiGuideSourceList  = 12    // a guide's sources the AI reads
	aiTitleLength      = 120
	aiSummaryLength    = 300
	aiSourcesLength    = 4000
	aiKnowledgeEntries = 300 // entries the knowledge base may hold
)

var aiEntryName = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// aiEntry is an entry of the knowledge base, as the AI reads it.
type aiEntry struct {
	Name    string `db:"name"`
	Kind    string `db:"kind"`
	Title   string `db:"title"`
	Summary string `db:"summary"`
	Body    string `db:"body"`
	Sources string `db:"sources"`
	Updated string `db:"updated"`
}

// changed is the day the entry last changed, "2006-01-02", or "".
func (e aiEntry) changed() string {
	if at, err := time.Parse(stampLayout, e.Updated); err == nil {
		return at.UTC().Format(time.DateOnly)
	}
	return ""
}

// sourceList is the entry's sources: one a line, a link and what it is.
func (e aiEntry) sourceList() []string {
	out := []string{}
	for _, line := range strings.Split(e.Sources, "\n") {
		if line = trim(collapse(line)); line != "" && len(out) < aiGuideSourceList {
			out = append(out, cut(line, 300))
		}
	}
	return out
}

// aiKnowledge is the knowledge base the AI uses: its rules and its guides, each in order, none
// switched off.
func aiKnowledge(app core.App) (rules, guides []aiEntry, err error) {
	all := []aiEntry{}
	if err := app.DB().NewQuery("SELECT name, kind, title, summary, body, sources, updated FROM armory_ai_knowledge WHERE disabled = FALSE ORDER BY position, lower(title), name").All(&all); err != nil {
		return nil, nil, err
	}
	for _, e := range all {
		switch {
		case e.Kind == "rule" && len(rules) < aiRules:
			rules = append(rules, e)
		case e.Kind == "guide" && len(guides) < aiGuidesListed:
			guides = append(guides, e)
		}
	}
	return rules, guides, nil
}

// aiKnowledgeNote is what the instructions say of the knowledge base: how to weigh it, every rule
// and the list of guides.
func aiKnowledgeNote(rules, guides []aiEntry, web bool) string {
	if len(rules) == 0 && len(guides) == 0 {
		return `Gearing knowledge:
This server keeps no knowledge base of AION 2's gear yet. Base advice on the armory's data (what the stronger players of the class wear and do) and say when a point is general advice rather than known for AION 2. AION 2 is not AION (2009): never carry AION's numbers, items or rules over.`
	}
	lines := []string{`Gearing knowledge:
The server's operators keep a knowledge base of how AION 2's gear works and what pays off. Rely on it over what you remember: AION 2 is not AION (2009), and its systems, items and numbers differ, so never carry AION's over. What the armory's data shows (the character, and what the stronger players of its class wear and do now) outranks the knowledge base's general advice where they disagree: say so when they do. Each guide says when it last changed; the game changes with its patches.`}
	if web {
		lines = append(lines, "When a guide may be out of date or does not cover a question, the web may: prefer recent sources about Global and say where a point comes from.")
	}
	if len(rules) > 0 {
		lines = append(lines, "", "Best practices (follow them in every plan):")
		for _, r := range rules {
			lines = append(lines, "- "+cut(collapse(r.Body), aiRuleLength))
		}
	}
	if len(guides) > 0 {
		lines = append(lines, "", "Guides (read those a question needs with read_guides before you explain a mechanic or advise on it, and follow them):")
		for _, g := range guides {
			line := "- " + g.Name + ": " + g.Title
			if summary := collapse(g.Summary); summary != "" {
				line += ". " + cut(summary, aiSummaryLength)
			}
			if day := g.changed(); day != "" {
				line += " (changed " + day + ")"
			}
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// readGuides answers read_guides: the guides named (up to aiGuidesRead), each with its text, its
// sources and when it last changed; a name no guide has is said so, with the names there are.
func (q *aiQuestion) readGuides(names []string) (map[string]any, error) {
	if len(names) == 0 {
		return nil, fmt.Errorf("name the guides to read, as the instructions list them")
	}
	if len(names) > aiGuidesRead {
		return nil, fmt.Errorf("read at most %d guides at once", aiGuidesRead)
	}
	_, guides, err := aiKnowledge(q.app)
	if err != nil {
		return nil, err
	}
	byName := map[string]aiEntry{}
	known := []string{}
	for _, g := range guides {
		byName[g.Name] = g
		known = append(known, g.Name)
	}
	read, missing, titles := []map[string]any{}, []string{}, []string{}
	for _, name := range names {
		name = strings.ToLower(trim(name))
		g, ok := byName[name]
		if !ok {
			missing = append(missing, cut(name, 60))
			continue
		}
		titles = append(titles, g.Title)
		guide := map[string]any{"name": g.Name, "title": g.Title, "text": cut(g.Body, aiGuideLength), "sources": g.sourceList()}
		if day := g.changed(); day != "" {
			guide["changed"] = day
		}
		read = append(read, guide)
	}
	switch len(titles) {
	case 0:
	case 1:
		q.out.status("Reading the guide {title}…", map[string]any{"title": titles[0]})
	default:
		q.out.status("Reading {n} guides…", map[string]any{"n": len(titles)})
	}
	out := map[string]any{"guides": read}
	if len(missing) > 0 {
		out["notes"] = []string{"No guide is named " + strings.Join(missing, ", ") + ". The guides: " + strings.Join(known, ", ") + "."}
	}
	return out, nil
}

// aiKnowledgeCounts is what Server controls show of the knowledge base: its rules and guides in
// use, the entries switched off and when it last changed.
func aiKnowledgeCounts(app core.App) (map[string]any, error) {
	counts := struct {
		Rules    int    `db:"rules"`
		Guides   int    `db:"guides"`
		Disabled int    `db:"disabled"`
		Updated  string `db:"updated"`
	}{}
	if err := app.DB().NewQuery("SELECT COUNT(CASE WHEN disabled = FALSE AND kind = 'rule' THEN 1 END) AS rules, COUNT(CASE WHEN disabled = FALSE AND kind = 'guide' THEN 1 END) AS guides, " +
		"COUNT(CASE WHEN disabled = TRUE THEN 1 END) AS disabled, COALESCE(MAX(updated), '') AS updated FROM armory_ai_knowledge").One(&counts); err != nil {
		return nil, err
	}
	out := map[string]any{"rules": min(counts.Rules, aiRules), "guides": min(counts.Guides, aiGuidesListed), "disabled": counts.Disabled, "updated": ""}
	if at, err := time.Parse(stampLayout, counts.Updated); err == nil {
		out["updated"] = isoTime(at)
	}
	return out, nil
}

// ---------------------------------------------------------------- the AI knowledge page

// knowledgeFields are an entry's fields a superuser edits, in the order the audit log names them.
var knowledgeFields = []string{"kind", "title", "name", "summary", "body", "sources", "position", "disabled"}

// knowledgeJSON is an entry as the AI knowledge page reads it.
func knowledgeJSON(r *core.Record) map[string]any {
	return map[string]any{"id": r.Id, "name": r.GetString("name"), "kind": r.GetString("kind"), "title": r.GetString("title"), "summary": r.GetString("summary"),
		"body": r.GetString("body"), "sources": r.GetString("sources"), "position": r.GetInt("position"), "disabled": r.GetBool("disabled"),
		"created": isoTime(r.GetDateTime("created").Time()), "updated": isoTime(r.GetDateTime("updated").Time())}
}

// knowledgeList answers the AI knowledge page: every entry, each kind in the order the AI reads
// them, with the limits the page checks and what the AI uses of them.
func knowledgeList(app core.App) (map[string]any, error) {
	records, err := app.FindRecordsByFilter("armory_ai_knowledge", "", "position,title,name", 0, 0)
	if err != nil {
		return nil, err
	}
	slices.SortStableFunc(records, func(a, b *core.Record) int {
		if a.GetInt("position") != b.GetInt("position") {
			return a.GetInt("position") - b.GetInt("position")
		}
		return strings.Compare(strings.ToLower(a.GetString("title")), strings.ToLower(b.GetString("title")))
	})
	entries := make([]map[string]any, len(records))
	for i, r := range records {
		entries[i] = knowledgeJSON(r)
	}
	counts, err := aiKnowledgeCounts(app)
	if err != nil {
		return nil, err
	}
	return map[string]any{"entries": entries, "counts": counts, "limits": map[string]any{"rules": aiRules, "ruleLength": aiRuleLength, "guides": aiGuidesListed,
		"body": aiGuideLength, "title": aiTitleLength, "summary": aiSummaryLength, "sources": aiSourcesLength, "sourcesRead": aiGuideSourceList, "entries": aiKnowledgeEntries}}, nil
}

// aiKnowledgeRoute answers GET /api/odyle/admin/ai/knowledge: { entries, counts, limits }.
// Superusers.
func aiKnowledgeRoute(e *core.RequestEvent) error {
	out, err := knowledgeList(e.App)
	if err != nil {
		return err
	}
	return e.JSON(200, out)
}

// knowledgeText is a multi-line text a superuser typed: line breaks as \n, invisible characters
// and the spaces ending its lines dropped, blank lines at its ends left out.
func knowledgeText(value any) string {
	s, _ := value.(string)
	s = strings.ReplaceAll(strings.ReplaceAll(visible(s), "\r\n", "\n"), "\r", "\n")
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRightFunc(line, isSpace)
	}
	return strings.Trim(strings.Join(lines, "\n"), "\n")
}

// aiKnowledgeSaveRoute answers POST /api/odyle/admin/ai/knowledge with { id?, kind, title, name,
// summary?, body, sources?, position?, disabled? }: saves the entry (a new one without id) and
// answers { entry } with the list. A new entry without a position comes after the others of its
// kind. Written to the audit log in the same transaction. Superusers.
func aiKnowledgeSaveRoute(e *core.RequestEvent) error {
	b, err := requestBody(e)
	if err != nil {
		return err
	}
	kind := b.str("kind")
	if kind != "rule" && kind != "guide" {
		return badRequest("Choose whether the entry is a best practice or a guide.")
	}
	title, err := text(b["title"], "Title", aiTitleLength)
	if err != nil {
		return err
	}
	name := strings.ToLower(trim(b.str("name")))
	if !aiEntryName.MatchString(name) || len(name) > 60 {
		return badRequest("The name is how the AI asks for a guide: lower-case letters, digits and dashes, like soul-binding (up to 60).")
	}
	summary := collapse(b.str("summary"))
	if length(summary) > aiSummaryLength {
		return badRequest(fmt.Sprintf("The summary is up to %d characters.", aiSummaryLength))
	}
	if kind == "guide" && summary == "" {
		return badRequest("Give the guide a summary: the AI picks the guides to read by it.")
	}
	content := knowledgeText(b["body"])
	switch {
	case content == "":
		return badRequest("Write the entry's text.")
	case kind == "rule" && length(content) > aiRuleLength:
		return badRequest(fmt.Sprintf("A best practice is up to %d characters: write a guide for more.", aiRuleLength))
	case length(content) > aiGuideLength:
		return badRequest(fmt.Sprintf("A guide is up to %d characters: split it into two.", aiGuideLength))
	}
	sources := []string{}
	for _, line := range strings.Split(knowledgeText(b["sources"]), "\n") {
		if line = trim(collapse(line)); line != "" {
			sources = append(sources, line)
		}
	}
	if length(strings.Join(sources, "\n")) > aiSourcesLength {
		return badRequest(fmt.Sprintf("The sources are up to %d characters.", aiSourcesLength))
	}
	var position int64 = -1
	if b.has("position") && b["position"] != nil {
		if position, err = integer(b["position"], "Position", 0, 9999); err != nil {
			return err
		}
	}
	disabled, hasDisabled := b.boolean("disabled")
	id := b.str("id")
	var saved *core.Record
	err = e.App.RunInTransaction(func(tx core.App) error {
		collection, err := tx.FindCachedCollectionByNameOrId("armory_ai_knowledge")
		if err != nil {
			return err
		}
		record := core.NewRecord(collection)
		var before *core.Record
		if id != "" {
			if record, err = tx.FindRecordById(collection, id); err != nil {
				return notFound("This entry no longer exists: someone deleted it.")
			}
			before = record.Original()
		} else {
			var n int
			if err := tx.DB().NewQuery("SELECT COUNT(*) FROM armory_ai_knowledge").Row(&n); err != nil {
				return err
			}
			if n >= aiKnowledgeEntries {
				return badRequest(fmt.Sprintf("The knowledge base holds up to %d entries: delete one first.", aiKnowledgeEntries))
			}
		}
		var taken int
		if err := tx.DB().NewQuery("SELECT COUNT(*) FROM armory_ai_knowledge WHERE name = {:name} AND id != {:id}").Bind(dbx.Params{"name": name, "id": id}).Row(&taken); err != nil {
			return err
		}
		if taken > 0 {
			return badRequest("Another entry is named " + name + ": names are unique.")
		}
		if position < 0 && before == nil {
			var last int64
			if err := tx.DB().NewQuery("SELECT COALESCE(MAX(position), 0) FROM armory_ai_knowledge WHERE kind = {:kind}").Bind(dbx.Params{"kind": kind}).Row(&last); err != nil {
				return err
			}
			position = min(9999, last+10)
		}
		record.Set("kind", kind)
		record.Set("title", title)
		record.Set("name", name)
		record.Set("summary", summary)
		record.Set("body", content)
		record.Set("sources", strings.Join(sources, "\n"))
		if position >= 0 {
			record.Set("position", position)
		}
		if hasDisabled {
			record.Set("disabled", disabled)
		}
		summaryLine, fields := knowledgeChange(before, record)
		if before != nil && len(fields) == 0 {
			saved = record
			return nil
		}
		if err := tx.Save(record); err != nil {
			return badRequest("The entry was not saved: " + message(err))
		}
		saved = record
		return audit(tx, e.Auth, auditAiKnowledge, viaOdyle, summaryLine, knowledgeDetails(record, fields))
	})
	if err != nil {
		return err
	}
	out, err := knowledgeList(e.App)
	if err != nil {
		return err
	}
	out["entry"] = knowledgeJSON(saved)
	return e.JSON(200, out)
}

// aiKnowledgeDeleteRoute answers DELETE /api/odyle/admin/ai/knowledge/{id}: deletes the entry and
// answers the list. Written to the audit log in the same transaction. Superusers.
func aiKnowledgeDeleteRoute(e *core.RequestEvent) error {
	err := e.App.RunInTransaction(func(tx core.App) error {
		record, err := tx.FindRecordById("armory_ai_knowledge", e.Request.PathValue("id"))
		if err != nil {
			return notFound("This entry no longer exists: someone deleted it.")
		}
		if err := tx.Delete(record); err != nil {
			return err
		}
		return audit(tx, e.Auth, auditAiKnowledge, viaOdyle, "Deleted "+knowledgeWhat(record), knowledgeDetails(record, nil))
	})
	if err != nil {
		return err
	}
	out, err := knowledgeList(e.App)
	if err != nil {
		return err
	}
	return e.JSON(200, out)
}

// knowledgeWhat names an entry in the audit log: "the AI guide Enchanting".
func knowledgeWhat(r *core.Record) string {
	kind := map[string]string{"rule": "best practice", "guide": "guide"}[r.GetString("kind")]
	if kind == "" {
		kind = "entry"
	}
	return "the AI " + kind + " " + cut(r.GetString("title"), 120)
}

// knowledgeChange is the audit log's line for a save of the entry (before is nil for a new one)
// and the fields it changes.
func knowledgeChange(before, after *core.Record) (string, []string) {
	if before == nil {
		return "Added " + knowledgeWhat(after), nil
	}
	fields := []string{}
	for _, f := range knowledgeFields {
		if fmt.Sprint(before.Get(f)) != fmt.Sprint(after.Get(f)) {
			fields = append(fields, f)
		}
	}
	switch {
	case slices.Equal(fields, []string{"disabled"}) && after.GetBool("disabled"):
		return "Switched off " + knowledgeWhat(after), fields
	case slices.Equal(fields, []string{"disabled"}):
		return "Switched on " + knowledgeWhat(after), fields
	}
	return "Changed " + knowledgeWhat(after), fields
}

func knowledgeDetails(r *core.Record, fields []string) map[string]any {
	details := map[string]any{"id": r.Id, "name": r.GetString("name"), "kind": r.GetString("kind"), "title": r.GetString("title")}
	if len(fields) > 0 {
		details["changed"] = fields
	}
	return details
}

// watchAiKnowledge writes what superusers change in the knowledge base under Collections →
// armory_ai_knowledge to the audit log, as the AI knowledge page's routes do theirs.
func watchAiKnowledge(app core.App) {
	note := func(e *core.RecordRequestEvent, summary string, fields []string) {
		if err := audit(e.App, e.Auth, auditAiKnowledge, viaCollections, summary, knowledgeDetails(e.Record, fields)); err != nil {
			warn(e.App, "Odyle could not write a change of the AI's knowledge base to the audit log", "error", err.Error())
		}
	}
	app.OnRecordCreateRequest("armory_ai_knowledge").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		summary, _ := knowledgeChange(nil, e.Record)
		note(e, summary, nil)
		return nil
	})
	app.OnRecordUpdateRequest("armory_ai_knowledge").BindFunc(func(e *core.RecordRequestEvent) error {
		before := e.Record.Original()
		if err := e.Next(); err != nil {
			return err
		}
		if summary, fields := knowledgeChange(before, e.Record); len(fields) > 0 {
			note(e, summary, fields)
		}
		return nil
	})
	app.OnRecordDeleteRequest("armory_ai_knowledge").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		note(e, "Deleted "+knowledgeWhat(e.Record), nil)
		return nil
	})
}
