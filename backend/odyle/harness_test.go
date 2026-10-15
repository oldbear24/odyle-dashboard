package odyle

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/oldbear24/odyle-dashboard/backend/migrations"
)

// newTestApp is PocketBase on an empty data directory with every Odyle migration
// applied and Odyle registered (routes, hooks and jobs; the jobs never run on their
// own), for tests that need the database or the hooks.
func newTestApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir(), EncryptionEnv: "pb_test_env"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	if err := app.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	Register(app)
	return app
}

// newUser saves an account with the given display name.
func newUser(t testing.TB, app core.App, name string) *core.Record {
	t.Helper()
	user, err := newRecord(app, "users")
	if err != nil {
		t.Fatal(err)
	}
	user.SetEmail(name + "@test.invalid")
	user.SetPassword("password-for-tests-only")
	user.Set("displayName", name)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	return user
}

// saved saves a record of the collection with the given values.
func saved(t testing.TB, app core.App, collection string, values map[string]any) *core.Record {
	t.Helper()
	record, err := newRecord(app, collection)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range values {
		record.Set(k, v)
	}
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

// countOf is how many records of the collection there are.
func countOf(t testing.TB, app core.App, collection string) int64 {
	t.Helper()
	n, err := app.CountRecords(collection)
	if err != nil {
		t.Fatal(err)
	}
	return n
}
