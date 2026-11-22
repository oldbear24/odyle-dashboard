package migrations

import (
	"fmt"
	"os"
	"path/filepath"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Odyle 1.0.0 no longer carries the one-time moves of data from before 0.61.0 and 0.62.0: the
// armory's images kept as files in pb_data/armory_images (0.61.0 to 0.67.1 turned them into
// records of armory_images at each start) and the armory profiles kept before the top players
// (0.62.0 to 0.67.1 gave them their rows every minute). A database those releases have not
// finished with would lose that data without a word, so this migration refuses it before
// anything of 1.0.0 changes the database: pending migrations run in one transaction, so the
// server stops with the message below and the data stays as the older release left it, ready
// for 0.67.1. It checks once, when a database first meets 1.0.0 (a backup restored from an
// older release meets it again), and never again on later starts.
//
// What it looks for, without asking any storage over the network:
//   - files in pb_data/armory_images: images 0.67.1 has not imported yet;
//   - armory profiles that hold a character while the armory has no top players at all: the
//     release that added the top players (0.62.0) never ranked a profile here. A server that ran
//     0.62.0 or newer has rows: every lookup ranks its profile, and the cleaning keeps each
//     class's top.
//
// Images under armory_images/ in an S3 storage come with profiles, so a server older than 0.61.0
// that kept them there is refused for its profiles.
func init() {
	register("1791763286_upgrade_floor.go", upgradeFloor, func(core.App) error { return nil })
}

// upgradeFloorMessage is the operator's instruction when the database is not ready for 1.0.0.
const upgradeFloorMessage = "Odyle 1.0.0 cannot start on this data yet: %s. Run Odyle 0.67.1 first and let it finish (%s), then update to 1.0.0. Nothing was changed."

func upgradeFloor(app core.App) error {
	if n, err := legacyImageFiles(app); err != nil {
		return err
	} else if n > 0 {
		return fmt.Errorf(upgradeFloorMessage, fmt.Sprintf("%d armory images kept before 0.61.0 are still in pb_data/armory_images", n),
			`it imports them at start and logs "Odyle imported the armory images kept before 0.61.0"; the folder is gone once it is done`)
	}
	var unranked, ranks int
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM armory_profiles WHERE fetchedAt != '' AND json_valid(profile) AND json_type(profile, '$.name') = 'text' AND json_extract(profile, '$.name') != ''").Row(&unranked); err != nil {
		return err
	}
	if err := app.DB().NewQuery("SELECT COUNT(*) FROM armory_ranks").Row(&ranks); err != nil {
		return err
	}
	if unranked > 0 && ranks == 0 {
		return fmt.Errorf(upgradeFloorMessage, fmt.Sprintf("%d armory profiles were kept before 0.62.0 and have not joined the top players", unranked),
			"it adds 200 a minute; the armory's Top players page lists them once it is done")
	}
	return nil
}

// legacyImageFiles counts the files in pb_data/armory_images, where the armory kept its images
// before 0.61.0; 0.61.0 to 0.67.1 removed the folder once every image in it was a record.
func legacyImageFiles(app core.App) (int, error) {
	entries, err := os.ReadDir(filepath.Join(app.DataDir(), "armory_images"))
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	n := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			n++
		}
	}
	return n, nil
}
