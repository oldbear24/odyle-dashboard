package odyle

import (
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Reset times of the Global service, edited by superusers in odyle_settings next to
// odylePerCube. Launch defaults: 07:00 UTC daily, Wednesday weekly.
func resets(app core.App) map[string]any {
	s := readSettings(app)
	return map[string]any{"dailyResetHour": s.DailyResetHour, "weeklyResetDay": s.WeeklyResetDay}
}

// Personal daily and weekly checklists in the account's order. doneAt is the last time
// the account checked a task; clients show it done while that is after the current
// reset (src/tasks.js), so nothing has to uncheck tasks and nothing is deleted at reset.
// A task on a character's list carries that character (its id, and its name as
// characterName); one on the account's own list has character "".
func tasksOf(app core.App, userId string, names map[string]string) ([]any, error) {
	found, err := app.FindRecordsByFilter("user_tasks", "user = {:user}", "position,created", 0, 0, dbx.Params{"user": userId})
	if err != nil {
		return nil, err
	}
	out := make([]any, len(found))
	for i, t := range found {
		j := t.PublicExport()
		j["characterName"] = names[t.GetString("character")]
		out[i] = j
	}
	return out, nil
}

// taskList is one list (the account's or a character's) of one cadence, in its order.
func taskList(app core.App, userId, cadence, character string) ([]*Task, error) {
	found, err := app.FindRecordsByFilter("user_tasks", "user = {:user} && cadence = {:cadence} && character = {:character}", "position,created", 0, 0, dbx.Params{"user": userId, "cadence": cadence, "character": character})
	return views[Task](found), err
}

// checklist is the account's tasks with the resets, its characters (the lists it can keep),
// the Global list and the limit of each list.
func checklist(app core.App, userId string) (map[string]any, error) {
	owned, err := charactersWhere(app, "user = {:user}", dbx.Params{"user": userId})
	if err != nil {
		return nil, err
	}
	names, characters := map[string]string{}, make([]any, len(owned))
	for i, c := range owned {
		names[c.Id] = c.Name()
		characters[i] = map[string]any{"id": c.Id, "characterName": c.Name(), "server": c.Server()}
	}
	list, err := tasksOf(app, userId, names)
	if err != nil {
		return nil, err
	}
	return map[string]any{"tasks": list, "resets": resets(app), "characters": characters, "templates": readSettings(app).TaskTemplates, "limit": taskLimit, "serverNow": now()}, nil
}

func tasks(e *core.RequestEvent) error {
	return run(e, func() error {
		out, err := checklist(e.App, e.Auth.Id)
		if err != nil {
			return err
		}
		return e.JSON(200, out)
	})
}

// One route for the checklist: { title, cadence, characterId? } adds a task to the account's
// list or to one of its characters', { templates: [titles], characterId? } adds tasks of the
// Global list, { id, done } stores or clears the time it was checked, { id, title } renames
// it, { id, move: 'up'|'down' } moves it within its list and { id, remove: true } deletes it.
// Tasks are private to the account and every answer carries the whole checklist.
func checklistTask(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		if b.set("id") {
			t, err := findAs[Task](app, "user_tasks", b.str("id"))
			if err != nil {
				return nil, notFound("This task no longer exists.")
			}
			if t.User() != user.Id {
				return nil, forbidden("This task belongs to another account.")
			}
			done, isDone := b.boolean("done")
			move, _ := b.text("move")
			switch {
			case b.isTrue("remove"):
				if err := app.Delete(t); err != nil {
					return nil, err
				}
			case isDone:
				t.SetDone(done)
				if err := app.Save(t); err != nil {
					return nil, err
				}
			case b.has("title"):
				title, _, err := task(b["title"], t.Cadence())
				if err != nil {
					return nil, err
				}
				t.SetTitle(title)
				if err := app.Save(t); err != nil {
					return nil, err
				}
			case move == "up" || move == "down":
				order, err := taskList(app, user.Id, t.Cadence(), t.Character())
				if err != nil {
					return nil, err
				}
				at := -1
				for i, x := range order {
					if x.Id == t.Id {
						at = i
					}
				}
				to := at + 1
				if move == "up" {
					to = at - 1
				}
				if to >= 0 && to < len(order) {
					order[at], order[to] = order[to], order[at]
				}
				for i, x := range order {
					if x.Position() != i+1 {
						x.SetPosition(i + 1)
						if err := app.Save(x); err != nil {
							return nil, err
						}
					}
				}
			default:
				return nil, badRequest("Send done (true or false), a new title, move (up or down) or remove: true.")
			}
		} else {
			character, err := taskScope(app, user.Id, b)
			if err != nil {
				return nil, err
			}
			if b.has("templates") {
				if err := addTemplates(app, user.Id, character, b["templates"]); err != nil {
					return nil, err
				}
				return checklist(app, user.Id)
			}
			title, cadence, err := task(b["title"], b["cadence"])
			if err != nil {
				return nil, err
			}
			if err := addTask(app, user.Id, character, title, cadence); err != nil {
				return nil, err
			}
			achieved(app, user.Id, nil, true)
		}
		return checklist(app, user.Id)
	})
}

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
		return nil, badRequest("Task templates must be a list of tasks.")
	}
	if len(list) > templateLimit {
		return nil, badRequest("The Global list can keep up to 100 tasks.")
	}
	out := []taskTemplate{}
	seen := map[string]bool{}
	for _, item := range list {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, badRequest("Task templates must be a list of tasks.")
		}
		title, cadence, err := task(entry["title"], entry["cadence"])
		if err != nil {
			return nil, err
		}
		if seen[strings.ToLower(title)] {
			return nil, badRequest("Each task of the Global list can be listed once.")
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
