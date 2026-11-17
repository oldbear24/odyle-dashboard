package odyle

import (
	"context"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem/blob"
)

// The armory's images (armoryimages.go) are records of armory_images: an image's name (PLAYNC's
// file name of an icon, portrait-<hash> of a portrait, class_icon_<class> of a class's emblem),
// its file and its size. PocketBase keeps the file in its file storage like the characters'
// portraits, on the data volume or in S3 storage while it is on (storage.go): superusers browse,
// search and delete them under Collections → armory_images, deleting a record deletes its file,
// and whether the server keeps an image is one indexed query. The dashboard loads them from
// /api/odyle/armory-images/<name> (armoryImageRoute).
//
// Before 0.61.0 they were files of their own, in pb_data/armory_images or under armory_images/ in
// the S3 storage. importLegacyImages turns those into records once the server serves; until it
// is done, the image route serves one not imported yet from where it was.

const armoryImagesCollection = "armory_images"

// imageCacheControl lets browsers, and any cache between them and the server, keep an image for
// a year: a name always shows the same image.
const imageCacheControl = "public, max-age=31536000, immutable"

// bucketTimeouts are how long a call to the file storage may take: listing it, reading, writing
// and deleting a file (the test build shortens them).
var bucketTimeouts = struct{ list, read, write, remove time.Duration }{list: 2 * time.Minute, read: time.Minute, write: time.Minute, remove: 30 * time.Second}

// keptImages are the names among the given ones that the server keeps.
func keptImages(app core.App, names []string) (map[string]bool, error) {
	kept := map[string]bool{}
	if len(names) == 0 {
		return kept, nil
	}
	found := []string{}
	err := app.DB().Select("name").From(armoryImagesCollection).Where(dbx.In("name", anys(unique(names))...)).Column(&found)
	for _, name := range found {
		kept[name] = true
	}
	return kept, err
}

// imageKept reports whether the server keeps the image; false when it cannot tell.
func imageKept(app core.App, name string) bool {
	kept, err := keptImages(app, []string{name})
	return err == nil && kept[name]
}

// saveImage keeps an image under its name, its file written to the file storage within
// bucketTimeouts.write. One kept under the name meanwhile (another lookup, the import) stays.
func saveImage(app core.App, name string, image []byte) error {
	collection, err := app.FindCachedCollectionByNameOrId(armoryImagesCollection)
	if err != nil {
		return err
	}
	file, err := filesystem.NewFileFromBytes(image, name)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("name", name)
	record.Set("file", file)
	record.Set("size", len(image))
	ctx, cancel := context.WithTimeout(context.Background(), bucketTimeouts.write)
	defer cancel()
	if err := app.SaveWithContext(ctx, record); err != nil {
		if imageKept(app, name) {
			return nil
		}
		return err
	}
	return nil
}

// storedReader is a file read from a storage, which it releases once closed.
type storedReader struct {
	*blob.Reader
	done func()
}

func (r storedReader) Close() error {
	err := r.Reader.Close()
	r.done()
	return err
}

// imageFile reads a kept image's file from the file storage; the read gives up after
// bucketTimeouts.read.
func imageFile(app core.App, record *core.Record) (io.ReadSeekCloser, error) {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), bucketTimeouts.read)
	fsys.SetContext(ctx)
	done := func() { cancel(); _ = fsys.Close() }
	r, err := fsys.GetReader(record.BaseFilesPath() + "/" + record.GetString("file"))
	if err != nil {
		done()
		return nil, err
	}
	return storedReader{r, done}, nil
}

// openBucket opens an S3 storage for one call, which gives up after the timeout; done releases it.
func openBucket(config core.S3Config, timeout time.Duration) (bucket *filesystem.System, done func(), err error) {
	bucket, err = filesystem.NewS3(config.Bucket, config.Region, config.Endpoint, config.AccessKey, config.Secret, config.ForcePathStyle)
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	bucket.SetContext(ctx)
	return bucket, func() { cancel(); _ = bucket.Close() }, nil
}

// legacyKey is where an image kept before 0.61.0 is in the S3 storage.
func legacyKey(name string) string { return armoryImagesDir + "/" + name }

// legacyImage reads an image kept before 0.61.0 from where it was: pb_data/armory_images, or
// armory_images/ in the S3 storage while it is on.
func legacyImage(app core.App, name string) (io.ReadSeekCloser, time.Time, error) {
	if file, err := os.Open(filepath.Join(imageDir(app), name)); err == nil {
		info, err := file.Stat()
		if err != nil {
			file.Close()
			return nil, time.Time{}, err
		}
		return file, info.ModTime(), nil
	}
	config := app.Settings().S3
	if !config.Enabled {
		return nil, time.Time{}, fs.ErrNotExist
	}
	bucket, done, err := openBucket(config, bucketTimeouts.read)
	if err != nil {
		return nil, time.Time{}, err
	}
	r, err := bucket.GetReader(legacyKey(name))
	if err != nil {
		done()
		return nil, time.Time{}, err
	}
	return storedReader{r, done}, r.ModTime(), nil
}

// startImport imports the images kept before 0.61.0 in the background (importLegacyImages), when
// the server serves and there may be some: the old folder is there, or the S3 storage is on.
func startImport(app core.App) {
	s := stateOf(app)
	if s.root != nil {
		app = s.root
	}
	if s.byHand.Load() || !exists(imageDir(app)) && !app.Settings().S3.Enabled || !s.importing.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer s.importing.Store(false)
		imported, failed, failure := importLegacyImages(app)
		switch {
		case failed > 0:
			warn(app, "Odyle could not import every armory image kept before 0.61.0; the rest stays where it was until the next start", "imported", imported, "failed", failed, "error", failure)
		case imported > 0:
			info(app, "Odyle imported the armory images kept before 0.61.0", "images", imported)
		}
	}()
}

// importLegacyImages turns the images kept before 0.61.0 into records of armory_images: those in
// pb_data/armory_images, then, while the S3 storage is on, those under armory_images/ in it. Each
// is deleted where it was once a record holds it (its own, or one kept meanwhile); one that fails
// stays there for the next start. The folder goes once empty.
func importLegacyImages(app core.App) (imported, failed int, failure string) {
	note := func(err error) {
		failed++
		failure = message(err)
	}
	if dir := imageDir(app); exists(dir) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			note(err)
		}
		for _, entry := range entries {
			path, name := filepath.Join(dir, entry.Name()), entry.Name()
			if entry.IsDir() {
				continue
			}
			// A download the server stopped in.
			if !imageNames.MatchString(name) {
				_ = os.Remove(path)
				continue
			}
			if !imageKept(app, name) {
				image, err := os.ReadFile(path)
				if err == nil {
					err = saveImage(app, name, image)
				}
				if err != nil {
					note(err)
					continue
				}
				imported++
			}
			if err := os.Remove(path); err != nil {
				note(err)
			}
		}
		_ = os.Remove(dir) // once empty
	}
	config := app.Settings().S3
	if !config.Enabled {
		return imported, failed, failure
	}
	bucket, done, err := openBucket(config, bucketTimeouts.list)
	if err != nil {
		note(err)
		return imported, failed, failure
	}
	objects, err := bucket.List(armoryImagesDir + "/")
	done()
	if err != nil {
		note(err)
		return imported, failed, failure
	}
	for _, o := range objects {
		name, ok := strings.CutPrefix(o.Key, armoryImagesDir+"/")
		if !ok || !imageNames.MatchString(name) {
			continue
		}
		saved, err := importBucketImage(app, config, name)
		if err != nil {
			note(err)
			continue
		}
		if saved {
			imported++
		}
	}
	return imported, failed, failure
}

// importBucketImage keeps an image kept before 0.61.0 under armory_images/ in the S3 storage as a
// record, unless one holds it already, then deletes it there; saved says whether it made the record.
func importBucketImage(app core.App, config core.S3Config, name string) (saved bool, err error) {
	if !imageKept(app, name) {
		bucket, done, err := openBucket(config, bucketTimeouts.read)
		if err != nil {
			return false, err
		}
		r, err := bucket.GetReader(legacyKey(name))
		if err != nil {
			done()
			return false, err
		}
		image, err := io.ReadAll(r)
		r.Close()
		done()
		if err == nil {
			err = saveImage(app, name, image)
		}
		if err != nil {
			return false, err
		}
		saved = true
	}
	bucket, done, err := openBucket(config, bucketTimeouts.remove)
	if err != nil {
		return saved, err
	}
	defer done()
	return saved, bucket.Delete(legacyKey(name))
}
