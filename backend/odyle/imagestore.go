package odyle

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem/blob"
)

// The armory's images (armoryimages.go) are kept in one of two places: the folder
// pb_data/armory_images on the data volume, or the S3 file storage under armory_images/ while
// it is on (Settings → Files storage, or ODYLE_STORAGE_S3_*, storage.go). The server keeps an
// index of the images stored there, their names, sizes and times, read once from the storage
// and again whenever the storage changes or the nightly clean-up lists it. A lookup so knows
// which images it has without asking the bucket for each, the image route answers a name it
// does not keep, or a browser asking whether an image changed, without asking it either, and
// the Server status page counts them without listing it.
//
// Listing the bucket can take a while, or hang on a storage that stopped answering, so nothing
// waits for a listing but the call that runs it: meanwhile the index answers what it held
// before, or that it cannot tell yet (the image route then asks the storage itself), and the
// images kept or deleted during the listing are added to what it found. Every call to the bucket
// gives up after a while (bucketTimeouts).

// imageListRetry is how long the index waits before it lists a storage again that failed.
const imageListRetry = time.Minute

// imageCacheControl lets browsers, and any cache between them and the server, keep an image for
// a year: a name always shows the same image.
const imageCacheControl = "public, max-age=31536000, immutable"

// bucketTimeouts are how long a call to the S3 storage may take: listing it, reading, writing
// and deleting an image (the test build shortens them).
var bucketTimeouts = struct{ list, read, write, remove time.Duration }{list: 2 * time.Minute, read: time.Minute, write: time.Minute, remove: 30 * time.Second}

// errImagesListing says that the storage is being listed, so the index cannot tell yet.
var errImagesListing = errors.New("The armory's images are being listed.")

type imageEntry struct {
	size int64
	at   time.Time
}

type imageStore struct {
	mu         sync.Mutex
	config     core.S3Config         // the storage the index describes; Enabled false is the folder
	opened     bool                  // config holds the storage last used
	generation int                   // counts the storages the index followed
	names      map[string]imageEntry // nil until listed
	listing    bool                  // a listing runs now
	changes    map[string]*imageEntry
	failedAt   time.Time // the last listing failed then
	failure    error
}

func imagesOf(app core.App) *imageStore { return &stateOf(app).images }

// bucketKey is an image's key in the S3 storage.
func bucketKey(name string) string { return armoryImagesDir + "/" + name }

// openBucket opens the S3 storage for one call, which gives up after the timeout; done releases it.
func openBucket(config core.S3Config, timeout time.Duration) (bucket *filesystem.System, done func(), err error) {
	bucket, err = filesystem.NewS3(config.Bucket, config.Region, config.Endpoint, config.AccessKey, config.Secret, config.ForcePathStyle)
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	bucket.SetContext(ctx)
	return bucket, func() { cancel(); _ = bucket.Close() }, nil
}

// follow makes the index describe the app's file storage, starting over when it changed, and
// answers it. Held s.mu.
func (s *imageStore) follow(app core.App) core.S3Config {
	if config := app.Settings().S3; !s.opened || config != s.config {
		s.config, s.opened, s.names, s.listing, s.changes, s.failedAt, s.failure = config, true, nil, false, nil, time.Time{}, nil
		s.generation++
	}
	return s.config
}

// ready answers the storage the index describes, listing it first when the index holds nothing
// yet; err says why the index cannot tell which images the storage holds.
func (s *imageStore) ready(app core.App) (core.S3Config, error) {
	s.mu.Lock()
	config := s.follow(app)
	switch {
	case s.names != nil:
		s.mu.Unlock()
		return config, nil
	case s.listing:
		s.mu.Unlock()
		return config, errImagesListing
	case time.Since(s.failedAt) < imageListRetry:
		err := s.failure
		s.mu.Unlock()
		return config, err
	}
	s.mu.Unlock()
	return config, s.list(app, config)
}

// list reads every image the storage holds into the index, without holding the lock meanwhile;
// what is kept or deleted while it runs is added to what it found.
func (s *imageStore) list(app core.App, config core.S3Config) error {
	s.mu.Lock()
	if s.config != config || s.listing {
		s.mu.Unlock()
		return errImagesListing
	}
	s.listing, s.changes = true, map[string]*imageEntry{}
	generation := s.generation
	s.mu.Unlock()
	names, err := listImages(app, config)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.generation != generation {
		return errImagesListing // another storage meanwhile; its own listing follows
	}
	changes := s.changes
	s.listing, s.changes = false, nil
	if err != nil {
		s.failedAt, s.failure = time.Now(), err
		return err
	}
	for name, e := range changes {
		if e == nil {
			delete(names, name)
		} else {
			names[name] = *e
		}
	}
	s.names, s.failure = names, nil
	return nil
}

// listImages reads every image a storage holds.
func listImages(app core.App, config core.S3Config) (map[string]imageEntry, error) {
	names := map[string]imageEntry{}
	if config.Enabled {
		bucket, done, err := openBucket(config, bucketTimeouts.list)
		if err != nil {
			return nil, err
		}
		defer done()
		objects, err := bucket.List(armoryImagesDir + "/")
		if err != nil {
			return nil, err
		}
		for _, o := range objects {
			if name, ok := strings.CutPrefix(o.Key, armoryImagesDir+"/"); ok && name != "" && !strings.Contains(name, "/") {
				names[name] = imageEntry{size: o.Size, at: o.ModTime}
			}
		}
		return names, nil
	}
	entries, err := os.ReadDir(imageDir(app))
	if errors.Is(err, fs.ErrNotExist) {
		return names, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if info, err := entry.Info(); err == nil && !entry.IsDir() {
			names[entry.Name()] = imageEntry{size: info.Size(), at: info.ModTime()}
		}
	}
	return names, nil
}

// noted keeps a change of the storage in the index (nil: the image is gone), when the index
// still describes that storage.
func (s *imageStore) noted(config core.S3Config, name string, e *imageEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.opened || s.config != config {
		return
	}
	if s.names != nil {
		if e == nil {
			delete(s.names, name)
		} else {
			s.names[name] = *e
		}
	}
	if s.listing {
		s.changes[name] = e
	}
}

// entry is the stored image of a name; known is false when the storage does not hold it, and
// err says why the index cannot tell (being listed, or the storage could not be listed).
func (s *imageStore) entry(app core.App, name string) (e imageEntry, known bool, err error) {
	if _, err := s.ready(app); err != nil {
		return imageEntry{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e, known = s.names[name]
	return e, known, nil
}

// has reports whether the storage holds the image (false while the index cannot tell).
func (s *imageStore) has(app core.App, name string) bool {
	_, known, _ := s.entry(app, name)
	return known
}

// put keeps an image under its name in the app's file storage, written whole or not at all.
func (s *imageStore) put(app core.App, name, contentType string, image []byte) error {
	s.mu.Lock()
	config := s.follow(app)
	s.mu.Unlock()
	if err := putImage(app, config, name, contentType, image); err != nil {
		return err
	}
	s.noted(config, name, &imageEntry{size: int64(len(image)), at: time.Now()})
	return nil
}

// putImage writes an image to a storage.
func putImage(app core.App, config core.S3Config, name, contentType string, image []byte) error {
	if !config.Enabled {
		dir := imageDir(app)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		return writeImage(dir, name, image)
	}
	bucket, done, err := openBucket(config, bucketTimeouts.write)
	if err != nil {
		return err
	}
	defer done()
	w, err := bucket.NewWriter(bucketKey(name), &blob.WriterOptions{ContentType: contentType, CacheControl: imageCacheControl})
	if err != nil {
		return err
	}
	if _, err := w.Write(image); err != nil {
		return errors.Join(err, w.Close())
	}
	return w.Close()
}

// bucketReader is an image read from the bucket, which releases the bucket once closed.
type bucketReader struct {
	*blob.Reader
	done func()
}

func (r bucketReader) Close() error {
	err := r.Reader.Close()
	r.done()
	return err
}

// open reads a stored image, with the time it was stored.
func (s *imageStore) open(app core.App, name string) (io.ReadSeekCloser, time.Time, error) {
	s.mu.Lock()
	config := s.follow(app)
	s.mu.Unlock()
	if config.Enabled {
		bucket, done, err := openBucket(config, bucketTimeouts.read)
		if err != nil {
			return nil, time.Time{}, err
		}
		r, err := bucket.GetReader(bucketKey(name))
		if err != nil {
			done()
			return nil, time.Time{}, err
		}
		return bucketReader{r, done}, r.ModTime(), nil
	}
	file, err := os.Open(filepath.Join(imageDir(app), name))
	if err != nil {
		return nil, time.Time{}, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, time.Time{}, err
	}
	return file, info.ModTime(), nil
}

// remove deletes a stored image.
func (s *imageStore) remove(app core.App, name string) error {
	s.mu.Lock()
	config := s.follow(app)
	s.mu.Unlock()
	var err error
	if config.Enabled {
		bucket, done, openErr := openBucket(config, bucketTimeouts.remove)
		if openErr != nil {
			return openErr
		}
		err = bucket.Delete(bucketKey(name))
		done()
	} else {
		err = os.Remove(filepath.Join(imageDir(app), name))
	}
	if err != nil && !errors.Is(err, blob.ErrNotFound) && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	s.noted(config, name, nil)
	return nil
}

// forget drops a name from the index, for one the storage turned out not to hold.
func (s *imageStore) forget(app core.App, name string) {
	s.mu.Lock()
	config := s.follow(app)
	s.mu.Unlock()
	s.noted(config, name, nil)
}

// relist lists the storage again and answers every image it holds, for the nightly clean-up.
// The index keeps answering from what it held meanwhile.
func (s *imageStore) relist(app core.App) (map[string]imageEntry, error) {
	s.mu.Lock()
	config := s.follow(app)
	s.mu.Unlock()
	if err := s.list(app, config); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]imageEntry, len(s.names))
	for name, e := range s.names {
		out[name] = e
	}
	return out, nil
}

// stats counts the stored images and their bytes, and says whether they are in the S3 storage
// and why the index could not count them ("" when it could).
func (s *imageStore) stats(app core.App) (count int, size int64, offHost bool, failure string) {
	config, err := s.ready(app)
	if err != nil {
		failure = message(err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.names {
		count++
		size += e.size
	}
	return count, size, config.Enabled, failure
}
