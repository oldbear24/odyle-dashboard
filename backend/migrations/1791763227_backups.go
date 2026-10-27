package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// PocketBase's scheduled backups (Settings → Backups): every night at 03:00 UTC, before
// the inactive-account clean-up at 03:17, keeping the newest seven. A schedule a
// superuser already set stays as it is. Backups land in pb_data/backups on the data
// volume unless S3 storage is configured (ODYLE_BACKUP_S3_*, backend/odyle/backups.go).
const backupSchedule, backupsKept = "0 3 * * *", 7

func init() {
	register("1791763227_backups.go", func(app core.App) error {
		settings, err := app.Settings().Clone()
		if err != nil {
			return err
		}
		if settings.Backups.Cron != "" {
			return nil
		}
		settings.Backups.Cron, settings.Backups.CronMaxKeep = backupSchedule, backupsKept
		return app.Save(settings)
	}, func(app core.App) error {
		settings, err := app.Settings().Clone()
		if err != nil {
			return err
		}
		if settings.Backups.Cron != backupSchedule || settings.Backups.CronMaxKeep != backupsKept {
			return nil
		}
		// PocketBase's defaults: no schedule, three kept once one is set.
		settings.Backups.Cron, settings.Backups.CronMaxKeep = "", 3
		return app.Save(settings)
	})
}
