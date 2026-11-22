package odyle

import (
	"context"
	"io"
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
// the S3 storage, which 0.61.0 to 0.67.1 turned into records once the server served. 1.0.0 no
// longer reads them there: a server whose folder still holds some does not start (the migration
// 1791763286_upgrade_floor.go).

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
