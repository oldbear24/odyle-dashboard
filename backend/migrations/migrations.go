// Package migrations holds the database migrations, compiled into the backend.
//
// They were JavaScript migrations once and keep their file names: PocketBase records
// applied migrations by name, so a database migrated by the previous backend runs
// none of them again, and a new database runs them all in order.
package migrations

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"
)

func register(file string, up, down func(app core.App) error) {
	if skipped(file) {
		return
	}
	core.AppMigrations.Register(up, down, file)
}

type m = map[string]any

// collection builds a collection from its definition the way PocketBase reads one
// from JSON, so a definition lists only what differs from the defaults.
func collection(definition m) *core.Collection {
	c := &core.Collection{}
	load(definition, c)
	return c
}

// field builds a field from its options, likewise.
func field[T core.Field](f T, options m) T {
	load(options, f)
	return f
}

func load(definition m, target any) {
	raw, err := json.Marshal(definition)
	if err == nil {
		err = json.Unmarshal(raw, target)
	}
	if err != nil {
		panic(err)
	}
}

// The created and updated dates most collections carry.
func dates() []any {
	return []any{m{"name": "created", "type": "autodate", "onCreate": true}, m{"name": "updated", "type": "autodate", "onCreate": true, "onUpdate": true}}
}

func fields(list ...any) []any {
	out := []any{}
	for _, item := range list {
		if many, ok := item.([]any); ok {
			out = append(out, many...)
		} else {
			out = append(out, item)
		}
	}
	return out
}

func saveAll(app core.App, items ...core.Model) error {
	for _, item := range items {
		if err := app.Save(item); err != nil {
			return err
		}
	}
	return nil
}

func deleteCollections(app core.App, names ...string) error {
	for _, name := range names {
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return err
		}
		if err := app.Delete(c); err != nil {
			return err
		}
	}
	return nil
}

func removeFields(app core.App, collectionName string, names ...string) error {
	c, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return err
	}
	for _, name := range names {
		c.Fields.RemoveByName(name)
	}
	return app.Save(c)
}

// setAll sets values on every record of a collection.
func setAll(app core.App, collectionName string, values m) error {
	records, err := app.FindAllRecords(collectionName)
	if err != nil {
		return err
	}
	for _, r := range records {
		for k, v := range values {
			r.Set(k, v)
		}
		if err := app.Save(r); err != nil {
			return err
		}
	}
	return nil
}
