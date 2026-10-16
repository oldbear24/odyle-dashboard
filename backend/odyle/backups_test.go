package odyle

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/archive"
)

func TestBackupsRunNightlyAndKeepAWeek(t *testing.T) {
	app := newTestApp(t)
	if b := app.Settings().Backups; b.Cron != "0 3 * * *" || b.CronMaxKeep != 7 || b.S3.Enabled {
		t.Fatalf("backups = %+v", b)
	}
	status := backupStatus(app)
	if got := asJSON(t, status); got != `{"schedule":"0 3 * * *","keep":7,"offHost":false,"setup":"","count":0,"latest":null,"error":""}` {
		t.Fatalf("status = %s", got)
	}
}

func TestOffHostBackupsComeFromTheEnvironment(t *testing.T) {
	app := newTestApp(t)
	// Nothing set: the storage stays as superusers saved it.
	if problem := configureBackups(app); problem != "" || app.Settings().Backups.S3.Enabled {
		t.Fatalf("without variables: %q", problem)
	}
	set := func(values map[string]string) {
		for _, name := range append(backupStorage, "FORCE_PATH_STYLE") {
			t.Setenv("ODYLE_BACKUP_S3_"+name, values[name])
		}
	}
	// Part of the storage is not enough, and a wrong flag is named.
	set(map[string]string{"BUCKET": "odyle-backups", "REGION": "eu-central-1"})
	if problem := configureBackups(app); !strings.Contains(problem, "ODYLE_BACKUP_S3_ENDPOINT, ODYLE_BACKUP_S3_ACCESS_KEY, ODYLE_BACKUP_S3_SECRET") || app.Settings().Backups.S3.Enabled {
		t.Fatalf("incomplete: %q", problem)
	}
	full := map[string]string{"BUCKET": "odyle-backups", "REGION": "eu-central-1", "ENDPOINT": "https://s3.example.test", "ACCESS_KEY": "key", "SECRET": "secret", "FORCE_PATH_STYLE": "yes"}
	set(full)
	if problem := configureBackups(app); !strings.Contains(problem, "FORCE_PATH_STYLE") || app.Settings().Backups.S3.Enabled {
		t.Fatalf("wrong flag: %q", problem)
	}
	// PocketBase refuses an endpoint that is not a URL; the server keeps running.
	full["FORCE_PATH_STYLE"], full["ENDPOINT"] = "true", "not a url"
	set(full)
	if problem := configureBackups(app); !strings.Contains(problem, "refused") || app.Settings().Backups.S3.Enabled {
		t.Fatalf("wrong endpoint: %q", problem)
	}
	full["ENDPOINT"] = "https://s3.example.test"
	set(full)
	if problem := configureBackups(app); problem != "" {
		t.Fatal(problem)
	}
	want := core.S3Config{Enabled: true, Bucket: "odyle-backups", Region: "eu-central-1", Endpoint: "https://s3.example.test", AccessKey: "key", Secret: "secret", ForcePathStyle: true}
	if got := app.Settings().Backups.S3; got != want {
		t.Fatalf("storage = %+v", got)
	}
	// The schedule stays, and the secret never reaches the status page.
	if b := app.Settings().Backups; b.Cron != "0 3 * * *" || b.CronMaxKeep != 7 {
		t.Fatalf("schedule = %+v", b)
	}
	app.Settings().Backups.S3.Endpoint = "http://127.0.0.1:9" // nothing listens: the listing fails quickly
	status := asJSON(t, backupStatus(app))
	if !strings.Contains(status, `"offHost":true`) || strings.Contains(status, "secret") || !strings.Contains(status, `"error":"`) || strings.Contains(status, `"error":""`) {
		t.Fatalf("status = %s", status)
	}
}

// The runbook's restore on a copy (docs/deployment.md): a backup unzipped into an empty
// data directory starts with every account, room and setting it holds.
func TestABackupRestoresOnACopy(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true, "odylePerCube": float64(55)}); err != nil {
		t.Fatal(err)
	}
	owner := newUser(t, app, "BackedUp")
	room := saved(t, app, "party_rooms", map[string]any{"owner": owner.Id, "name": "Backed up room", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": owner.Id, "role": "owner"})
	if err := app.CreateBackup(context.Background(), "drill.zip"); err != nil {
		t.Fatal(err)
	}
	count, latest, failure := stateOf(app).backups.read(app)
	if count != 1 || latest == nil || latest.Name != "drill.zip" || latest.Size == 0 || failure != "" {
		t.Fatalf("listed %d, %+v, %q", count, latest, failure)
	}
	copyDir := t.TempDir()
	if err := archive.Extract(filepath.Join(app.DataDir(), core.LocalBackupsDirName, "drill.zip"), copyDir); err != nil {
		t.Fatal(err)
	}
	restored := core.NewBaseApp(core.BaseAppConfig{DataDir: copyDir, EncryptionEnv: "pb_test_env"})
	if err := restored.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	defer restored.ClearBootstrap()
	if err := restored.RunAppMigrations(); err != nil {
		t.Fatal(err)
	}
	if _, err := restored.FindRecordById("party_rooms", room.Id); err != nil {
		t.Fatalf("the room: %v", err)
	}
	if user, err := restored.FindRecordById("users", owner.Id); err != nil || user.GetString("displayName") != "BackedUp" {
		t.Fatalf("the account: %v", err)
	}
	if got := loadSettings(restored).OdylePerCube; got != 55 {
		t.Fatalf("Odyle per cube on the copy: %d", got)
	}
	if b := restored.Settings().Backups; b.Cron != "0 3 * * *" {
		t.Fatalf("backups on the copy: %+v", b)
	}
}
