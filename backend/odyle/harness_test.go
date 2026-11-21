package odyle

import (
	"os"
	"sync"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

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
	// Nothing in the tests may reach GitHub or PLAYNC: a saved character starts a portrait lookup
	// in the background whether or not the test pauses portraits. Port 9 (discard) refuses at
	// once. Tests of the release lookup, the armory and the portraits set their own servers.
	for name, link := range map[string]string{
		"ODYLE_WINDOWS_RELEASE_URL": "http://127.0.0.1:9/releases/latest",
		"PLAYNC_SEARCH_URL":         "http://127.0.0.1:9/search",
		"PLAYNC_ARMORY_URL":         "http://127.0.0.1:9",
		"PLAYNC_IMAGE_URL":          "http://127.0.0.1:9",
		"PLAYNC_ASSETS_URL":         "http://127.0.0.1:9/assets/",
		"PLAYNC_CLASS_ICONS_URL":    "http://127.0.0.1:9/class/",
	} {
		if os.Getenv(name) == "" {
			t.Setenv(name, link)
		}
	}
	dir, err := migratedDataDir()
	if err != nil {
		t.Fatal(err)
	}
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: dir, EncryptionEnv: "pb_test_env"})
	if err != nil {
		t.Fatal(err)
	}
	Register(app)
	// Every request of a test serves, which would start moving files into S3 storage and importing
	// old armory images in the background; tests run them themselves.
	stateOf(app).byHand.Store(true)
	// PocketBase starts its cron when the app serves, and every request of a test serves, so
	// the jobs ran whenever a minute began, even while a test tore its app down (a data race
	// under go test -race). Tests run the jobs they check themselves.
	app.OnServe().Unbind("__pbCronStart__")
	// A character saved by the test starts its portrait lookup in the background; it ends
	// before the app is torn down, or it races the clean-up (go test -race).
	t.Cleanup(func() {
		stateOf(app).portraits.wait()
		stateOf(app).pushes.Wait()
		app.Cleanup()
	})
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

// share shares the characters in the membership's room (room_shares).
func share(t testing.TB, app core.App, member *core.Record, characters ...string) {
	t.Helper()
	if err := shareIn(app, viewOf[Member](member), characters...); err != nil {
		t.Fatal(err)
	}
}

// sharingMember saves a room membership with the given values that shares the characters.
func sharingMember(t testing.TB, app core.App, values map[string]any, characters ...string) *core.Record {
	t.Helper()
	member := saved(t, app, "room_members", values)
	share(t, app, member, characters...)
	return member
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
