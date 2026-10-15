package migrations

import "github.com/pocketbase/pocketbase/core"

// Checklist tasks keep the order their account gives them (move up and down on the
// dashboard); existing tasks keep their creation order within each list.
func init() {
	register("1791763221_task_order.js", func(app core.App) error {
		tasks, err := app.FindCollectionByNameOrId("user_tasks")
		if err != nil {
			return err
		}
		tasks.Fields.Add(field(&core.NumberField{}, m{"name": "position", "onlyInt": true}))
		if err := app.Save(tasks); err != nil {
			return err
		}
		all, err := app.FindRecordsByFilter("user_tasks", `id != ""`, "created", 0, 0)
		if err != nil {
			return err
		}
		next := map[string]int{}
		for _, t := range all {
			list := t.GetString("user") + "|" + t.GetString("cadence")
			next[list]++
			t.Set("position", next[list])
			if err := app.Save(t); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		return removeFields(app, "user_tasks", "position")
	})
}
