package odyle

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/oldbear24/odyle-dashboard/backend/migrations"
)

func TestMain(m *testing.M) {
	code := m.Run()
	if migrated.dir != "" {
		os.RemoveAll(migrated.dir)
	}
	os.Exit(code)
}

// migrated is a data directory with every migration applied, made once; each test app
// starts on a copy of it instead of migrating a database of its own.
var migrated struct {
	once sync.Once
	dir  string
	err  error
}

func migratedDataDir() (string, error) {
	migrated.once.Do(func() {
		if migrated.dir, migrated.err = os.MkdirTemp("", "odyle-test-data-"); migrated.err != nil {
			return
		}
		app := core.NewBaseApp(core.BaseAppConfig{DataDir: migrated.dir, EncryptionEnv: "pb_test_env"})
		if migrated.err = app.Bootstrap(); migrated.err == nil {
			migrated.err = app.RunAppMigrations()
		}
		if err := app.ClearBootstrap(); migrated.err == nil {
			migrated.err = err
		}
	})
	return migrated.dir, migrated.err
}

// newTestApp is PocketBase on a fresh database with every Odyle migration applied and
// Odyle registered (routes, hooks and jobs; the jobs never run on their own), for tests
// that need the database or the hooks.
func newTestApp(t testing.TB) *tests.TestApp {
	t.Helper()
	// Nothing in the tests may reach GitHub; tests of the release lookup set their own feed.
	if os.Getenv("ODYLE_WINDOWS_RELEASE_URL") == "" {
		t.Setenv("ODYLE_WINDOWS_RELEASE_URL", "http://127.0.0.1:9/releases/latest")
	}
	dir, err := migratedDataDir()
	if err != nil {
		t.Fatal(err)
	}
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: dir, EncryptionEnv: "pb_test_env"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
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
