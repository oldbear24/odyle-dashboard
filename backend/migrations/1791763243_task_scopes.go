package migrations

import "github.com/pocketbase/pocketbase/core"

// Checklists per character and Global task templates (#38): a task belongs to the account or
// to one of its own characters (user_tasks.character, gone with the character), and superusers
// keep a list of daily and weekly tasks players add in one go (odyle_settings.taskTemplates,
// empty until they fill it).
func init() {
	register("1791763243_task_scopes.go", func(app core.App) error {
		tasks, err := app.FindCollectionByNameOrId("user_tasks")
		if err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		tasks.Fields.Add(field(&core.RelationField{}, m{"name": "character", "collectionId": characters.Id, "cascadeDelete": true, "maxSelect": 1}))
		tasks.AddIndex("idx_user_tasks_scope", false, "user, character, cadence", "")
		if err := app.Save(tasks); err != nil {
			return err
		}
		settings, err := app.FindCollectionByNameOrId("odyle_settings")
		if err != nil {
			return err
		}
		settings.Fields.Add(field(&core.JSONField{}, m{"name": "taskTemplates", "maxSize": 20000}))
		return app.Save(settings)
	}, func(app core.App) error {
		tasks, err := app.FindCollectionByNameOrId("user_tasks")
		if err != nil {
			return err
		}
		tasks.RemoveIndex("idx_user_tasks_scope")
		if err := app.Save(tasks); err != nil {
			return err
		}
		if err := removeFields(app, "user_tasks", "character"); err != nil {
			return err
		}
		return removeFields(app, "odyle_settings", "taskTemplates")
	})
}
