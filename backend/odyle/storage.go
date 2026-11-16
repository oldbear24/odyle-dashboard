package odyle

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
)

// S3 file storage: ODYLE_STORAGE_S3_BUCKET, _REGION, _ENDPOINT, _ACCESS_KEY and _SECRET (with
// _FORCE_PATH_STYLE=true for hosts that need it) set PocketBase's file storage (Settings → Files
// storage) at every start, as ODYLE_BACKUP_S3_* set the backups' (backups.go), so the secret
// stays out of the repository and the image. While it is on, PocketBase keeps the characters'
// portraits in the bucket and the armory its images under armory_images/ (imagestore.go), and
// nothing of them stays on the data volume: the files kept on disk before are moved into the
// bucket when the server starts or a superuser turns the storage on (moveToBucket). Browsers
// load them from the Odyle server as before, which keeps them a year (the armory's images) or
// a month (portraits). Every file is a copy of one of PLAYNC's, so the bucket needs no backup;
// backups hold the database only.

// configureStorage applies ODYLE_STORAGE_S3_* to the file storage settings, saving them only when
// they change, and answers what kept it from doing so (empty when nothing did). A wrong setting
// never stops the server: files then stay where they are.
func configureStorage(app core.App) string {
	next, given, problem := s3FromEnvironment("ODYLE_STORAGE_S3_", "S3 file storage also needs", "files stay where they are")
	if !given || problem != "" {
		return problem
	}
	if app.Settings().S3 == next {
		return ""
	}
	settings, err := app.Settings().Clone()
	if err == nil {
		settings.S3 = next
		err = app.Save(settings)
	}
	if err != nil {
		return "The ODYLE_STORAGE_S3_* storage was refused (" + err.Error() + "); files stay where they are."
	}
	info(app, "Odyle keeps files in S3 storage", "bucket", next.Bucket, "endpoint", next.Endpoint)
	return ""
}

// storageMove is the last move of the files on disk into the S3 storage.
type storageMove struct {
	At     string `json:"at"`
	Files  int    `json:"files"`
	Bytes  int64  `json:"bytes"`
	Failed int    `json:"failed"`
	Error  string `json:"error"`
}

// startMove moves the files on disk into the S3 storage in the background (moveToBucket), when
// the storage is on, the server serves and no move runs already.
func startMove(app core.App) {
	s := stateOf(app)
	if s.root != nil {
		app = s.root
	}
	if !app.Settings().S3.Enabled || !s.serving.Load() || !s.moving.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer s.moving.Store(false)
		move := moveToBucket(app)
		s.mu.Lock()
		s.storageMove = move
		s.mu.Unlock()
		switch {
		case move.Failed > 0 || move.Error != "":
			warn(app, "Odyle could not move every file into the S3 storage; the rest stays on disk until the next start", "moved", move.Files, "failed", move.Failed, "error", move.Error)
		case move.Files > 0:
			info(app, "Odyle moved the files on disk into the S3 storage", "files", move.Files, "bytes", move.Bytes)
		}
	}()
}

// moveToBucket moves the files kept on disk into the S3 storage, once it is on: PocketBase's own
// (pb_data/storage, the characters' portraits) and the armory's images (pb_data/armory_images).
// Each is uploaded unless the bucket holds it already, then deleted from the disk; one that
// fails stays there for the next move, and the folders left empty go.
func moveToBucket(app core.App) *storageMove {
	move := &storageMove{}
	defer func() { move.At = now() }()
	if !app.Settings().S3.Enabled {
		return move
	}
	failed := func(err error) {
		move.Failed++
		move.Error = message(err)
	}
	bucket, err := app.NewFilesystem()
	if err != nil {
		failed(err)
		return move
	}
	defer bucket.Close()
	if dir := filepath.Join(app.DataDir(), core.LocalStorageDirName); exists(dir) {
		local, err := filesystem.NewLocal(dir)
		if err != nil {
			failed(err)
			return move
		}
		defer local.Close()
		files, err := local.List("")
		if err != nil {
			failed(err)
		}
		for _, f := range files {
			if err := moveFile(local, bucket, f.Key); err != nil {
				failed(err)
				continue
			}
			move.Files++
			move.Bytes += f.Size
		}
		removeEmptyDirs(dir)
	}
	if dir := imageDir(app); exists(dir) {
		store := imagesOf(app)
		entries, err := os.ReadDir(dir)
		if err != nil {
			failed(err)
		}
		for _, entry := range entries {
			path, name := filepath.Join(dir, entry.Name()), entry.Name()
			stat, err := entry.Info()
			if err != nil || entry.IsDir() {
				continue
			}
			// A download the server stopped in.
			if !imageNames.MatchString(name) {
				_ = os.Remove(path)
				continue
			}
			if !store.has(app, name) {
				image, err := os.ReadFile(path)
				if err == nil {
					err = store.put(app, name, imageTypesByExtension[filepath.Ext(name)], image)
				}
				if err != nil {
					failed(err)
					continue
				}
			}
			if err := os.Remove(path); err != nil {
				failed(err)
				continue
			}
			move.Files++
			move.Bytes += stat.Size()
		}
		_ = os.Remove(dir) // once empty
	}
	return move
}

// moveFile copies a file of the local storage into the bucket, unless it holds it already, and
// deletes it from the disk.
func moveFile(local, bucket *filesystem.System, key string) error {
	there, err := bucket.Exists(key)
	if err != nil {
		return err
	}
	if !there {
		r, err := local.GetReader(key)
		if err != nil {
			return err
		}
		content, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			return err
		}
		if err := bucket.Upload(content, key); err != nil {
			return err
		}
	}
	return local.Delete(key)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// removeEmptyDirs deletes the empty folders under root, deepest first; root stays.
func removeEmptyDirs(root string) {
	dirs := []string{}
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err == nil && d.IsDir() && path != root {
			dirs = append(dirs, path)
		}
		return nil
	})
	for i := len(dirs) - 1; i >= 0; i-- {
		_ = os.Remove(dirs[i]) // fails while not empty
	}
}

// storageStatus is the Server status page's view of the files: whether they are kept in the S3
// storage (offHost) and which bucket, what kept ODYLE_STORAGE_S3_* from applying, and the last
// move of the files on disk into the bucket (moved; moving while one runs).
func storageStatus(app core.App) *object {
	s := stateOf(app)
	s.mu.Lock()
	setup, moved := s.storageSetup, s.storageMove
	s.mu.Unlock()
	config, bucket := app.Settings().S3, ""
	if config.Enabled {
		bucket = config.Bucket
	}
	return newObject().set("offHost", config.Enabled).set("bucket", bucket).set("setup", setup).set("moving", s.moving.Load()).set("moved", moved)
}
