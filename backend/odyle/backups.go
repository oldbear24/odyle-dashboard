package odyle

import (
	"context"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Backups are PocketBase's own (Settings → Backups): migration 1791763226_backups.go
// schedules one every night at 03:00 UTC and keeps the newest seven, unless a superuser
// set a schedule first. They land in pb_data/backups, on the same volume as the data,
// unless S3-compatible storage holds them: ODYLE_BACKUP_S3_BUCKET, _REGION, _ENDPOINT,
// _ACCESS_KEY and _SECRET (with _FORCE_PATH_STYLE=true for hosts that need it) set that
// storage at every start, so its secret stays out of the repository and the image. The
// Server status page shows the newest backup, the schedule and where backups are kept.

var backupStorage = []string{"BUCKET", "REGION", "ENDPOINT", "ACCESS_KEY", "SECRET"}

// configureBackups applies ODYLE_BACKUP_S3_* to the backup settings, saving them only
// when they change, and answers what kept it from doing so (empty when nothing did). A
// wrong setting never stops the server: backups then stay where they were.
func configureBackups(app core.App) string {
	values, missing, given := map[string]string{}, []string{}, false
	for _, name := range backupStorage {
		values[name] = strings.TrimSpace(os.Getenv("ODYLE_BACKUP_S3_" + name))
		if values[name] == "" {
			missing = append(missing, "ODYLE_BACKUP_S3_"+name)
		} else {
			given = true
		}
	}
	if !given {
		return ""
	}
	if len(missing) > 0 {
		return "Off-host backups also need " + strings.Join(missing, ", ") + "; backups stay where they were."
	}
	pathStyle := false
	if raw := strings.TrimSpace(os.Getenv("ODYLE_BACKUP_S3_FORCE_PATH_STYLE")); raw != "" {
		var err error
		if pathStyle, err = strconv.ParseBool(raw); err != nil {
			return "ODYLE_BACKUP_S3_FORCE_PATH_STYLE must be true or false; backups stay where they were."
		}
	}
	next := core.S3Config{Enabled: true, Bucket: values["BUCKET"], Region: values["REGION"], Endpoint: values["ENDPOINT"], AccessKey: values["ACCESS_KEY"], Secret: values["SECRET"], ForcePathStyle: pathStyle}
	if app.Settings().Backups.S3 == next {
		return ""
	}
	settings, err := app.Settings().Clone()
	if err == nil {
		settings.Backups.S3 = next
		err = app.Save(settings)
	}
	if err != nil {
		return "The ODYLE_BACKUP_S3_* storage was refused (" + err.Error() + "); backups stay where they were."
	}
	info(app, "Odyle keeps backups in S3 storage", "bucket", next.Bucket, "endpoint", next.Endpoint)
	return ""
}

// backupFile is a backup as the Server status page shows it.
type backupFile struct {
	Name string `json:"name"`
	At   string `json:"at"`
	Size int64  `json:"size"`
}

// backupList is what the backup storage held at the last look. Listing S3 storage is a
// request to it, so the page's refresh every 10 seconds looks at most once a minute;
// a new backup (made by the schedule or by hand) is seen at once.
type backupList struct {
	mu      sync.Mutex
	at      time.Time
	offHost bool
	count   int
	latest  *backupFile
	err     string
}

const backupListAge = time.Minute

func (l *backupList) drop() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.at = time.Time{}
}

func (l *backupList) read(app core.App) (count int, latest *backupFile, failure string) {
	offHost := app.Settings().Backups.S3.Enabled
	l.mu.Lock()
	if !l.at.IsZero() && time.Since(l.at) < backupListAge && l.offHost == offHost {
		defer l.mu.Unlock()
		return l.count, l.latest, l.err
	}
	l.mu.Unlock()
	count, latest, failure = listBackups(app)
	l.mu.Lock()
	defer l.mu.Unlock()
	l.at, l.offHost, l.count, l.latest, l.err = time.Now(), offHost, count, latest, failure
	return count, latest, failure
}

// listBackups counts the stored backups and finds the newest.
func listBackups(app core.App) (int, *backupFile, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	fsys, err := app.NewBackupsFilesystem()
	if err != nil {
		return 0, nil, err.Error()
	}
	defer fsys.Close()
	fsys.SetContext(ctx)
	files, err := fsys.List("")
	if err != nil {
		return 0, nil, err.Error()
	}
	var latest *backupFile
	for _, f := range files {
		at := f.ModTime.UTC().Format(isoLayout)
		if latest == nil || at > latest.At {
			latest = &backupFile{Name: f.Key, At: at, Size: f.Size}
		}
	}
	return len(files), latest, ""
}

// backupStatus is the Server status page's view of the backups: the schedule and how
// many it keeps, whether they are kept off the host, how many are stored and the newest.
func backupStatus(app core.App) *object {
	s := stateOf(app)
	s.mu.Lock()
	setup := s.backupSetup
	s.mu.Unlock()
	config := app.Settings().Backups
	count, latest, failure := s.backups.read(app)
	return newObject().set("schedule", config.Cron).set("keep", config.CronMaxKeep).set("offHost", config.S3.Enabled).set("setup", setup).
		set("count", count).set("latest", latest).set("error", failure)
}
