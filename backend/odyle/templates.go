package odyle

import (
	"errors"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Checklists per character and Global task templates (#38). A task belongs to the account or
// to one of its own characters, so alts keep their own dailies and weeklies; each of those
// lists keeps up to taskLimit tasks. Superusers keep the Global list of daily and weekly tasks
// (Game settings), and players add several of them to one list at once. Rows stay ticks:
// nothing is counted or typed in about a character (R1).

const taskLimit, templateLimit = 40, 100

// taskTemplate is a task of the Global list.
type taskTemplate struct {
	Title   string `json:"title"`
	Cadence string `json:"cadence"`
}

// checkTemplates checks the Global list to save: up to 100 tasks, each title once.
func checkTemplates(value any) ([]taskTemplate, error) {
	list, ok := value.([]any)
	if !ok {
		return nil, errors.New("Task templates must be a list of tasks.")
	}
	if len(list) > templateLimit {
		return nil, errors.New("The Global list can keep up to 100 tasks.")
	}
	out := []taskTemplate{}
	seen := map[string]bool{}
	for _, item := range list {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("Task templates must be a list of tasks.")
		}
		title, cadence, err := task(entry["title"], entry["cadence"])
		if err != nil {
			return nil, err
		}
		if seen[strings.ToLower(title)] {
			return nil, errors.New("Each task of the Global list can be listed once.")
		}
		seen[strings.ToLower(title)] = true
		out = append(out, taskTemplate{Title: title, Cadence: cadence})
	}
	return out, nil
}

// storedTemplates reads the saved Global list; a task it cannot read is left out.
func storedTemplates(value any) []taskTemplate {
	out := []taskTemplate{}
	list, _ := value.([]any)
	for _, item := range list {
		if entry, ok := item.(map[string]any); ok {
			if title, cadence, err := task(entry["title"], entry["cadence"]); err == nil {
				out = append(out, taskTemplate{Title: title, Cadence: cadence})
			}
		}
	}
	return out
}

// templateNamed is the Global task with that title (in any case), or nil.
func templateNamed(templates []taskTemplate, title string) *taskTemplate {
	for i := range templates {
		if strings.EqualFold(templates[i].Title, strings.TrimSpace(title)) {
			return &templates[i]
		}
	}
	return nil
}

// taskScope is the list a new task goes to: the account's ("") or one of its characters'.
func taskScope(app core.App, userId string, b body) (string, error) {
	if !b.set("characterId") {
		return "", nil
	}
	c, err := ownCharacter(app, userId, b.str("characterId"))
	if err != nil {
		return "", err
	}
	return c.Id, nil
}

// addTask appends a task to the end of its list, within the list's limit.
func addTask(app core.App, userId, character, title, cadence string) error {
	count, err := app.CountRecords("user_tasks", dbx.HashExp{"user": userId, "character": character})
	if err != nil {
		return err
	}
	if count >= taskLimit {
		return badRequest("Each list keeps up to 40 tasks.")
	}
	order, err := taskList(app, userId, cadence, character)
	if err != nil {
		return err
	}
	t, err := newAs[Task](app, "user_tasks")
	if err != nil {
		return err
	}
	position := 1
	if len(order) > 0 {
		position = order[len(order)-1].Position() + 1
	}
	t.Set("user", userId)
	t.Set("character", character)
	t.Set("cadence", cadence)
	t.SetTitle(title)
	t.SetPosition(position)
	return app.Save(t)
}

// addTemplates adds tasks of the Global list to one list; those it already has (the same
// title, in any case) are left out, so adding the list twice changes nothing.
func addTemplates(app core.App, userId, character string, value any) error {
	titles, ok := value.([]any)
	if !ok || len(titles) == 0 {
		return badRequest("Choose tasks from the Global list.")
	}
	templates := readSettings(app).TaskTemplates
	existing, err := app.FindRecordsByFilter("user_tasks", "user = {:user} && character = {:character}", "", 0, 0, dbx.Params{"user": userId, "character": character})
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for _, t := range existing {
		have[strings.ToLower(t.GetString("title"))] = true
	}
	for _, v := range titles {
		title, _ := v.(string)
		found := templateNamed(templates, title)
		if found == nil {
			return badRequest("Choose tasks from the Global list.")
		}
		if have[strings.ToLower(found.Title)] {
			continue
		}
		if err := addTask(app, userId, character, found.Title, found.Cadence); err != nil {
			return err
		}
		have[strings.ToLower(found.Title)] = true
	}
	return nil
}
