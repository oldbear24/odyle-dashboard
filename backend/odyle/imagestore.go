package odyle

import (
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

// imageListRetry is how long the index waits before it lists a storage again that failed.
const imageListRetry = time.Minute

// imageCacheControl lets browsers, and any cache between them and the server, keep an image for
// a year: a name always shows the same image.
const imageCacheControl = "public, max-age=31536000, immutable"

type imageEntry struct {
	size int64
	at   time.Time
}

type imageStore struct {
	mu       sync.Mutex
	config   core.S3Config      // the storage the index describes; Enabled false is the folder
	opened   bool               // config holds the storage last used
	bucket   *filesystem.System // the S3 storage while it is on
	names    map[string]imageEntry
	failedAt time.Time // the last listing failed then
	failure  error
}

func imagesOf(app core.App) *imageStore { return &stateOf(app).images }

// bucketKey is an image's key in the S3 storage.
func bucketKey(name string) string { return armoryImagesDir + "/" + name }

// current makes the store follow the app's file storage, opening the bucket and listing it when
// it changed or was not listed yet, and answers the storage to write to: the bucket, or nil for
// the folder. Held s.mu.
func (s *imageStore) current(app core.App) (*filesystem.System, error) {
	config := app.Settings().S3
	if !s.opened || config != s.config {
		if s.bucket != nil {
			_ = s.bucket.Close()
		}
		s.config, s.opened, s.bucket, s.names, s.failedAt, s.failure = config, true, nil, nil, time.Time{}, nil
		if config.Enabled {
			bucket, err := filesystem.NewS3(config.Bucket, config.Region, config.Endpoint, config.AccessKey, config.Secret, config.ForcePathStyle)
			if err != nil {
				s.failedAt, s.failure = time.Now(), err
				return nil, err
			}
			s.bucket = bucket
		}
	}
	if config.Enabled && s.bucket == nil {
		return nil, s.failure
	}
	if s.names == nil {
		if time.Since(s.failedAt) < imageListRetry {
			return s.bucket, s.failure
		}
		names, err := s.list(app)
		if err != nil {
			s.failedAt, s.failure = time.Now(), err
			return s.bucket, err
		}
		s.names, s.failure = names, nil
	}
	return s.bucket, nil
}

// list reads every image the storage holds. Held s.mu.
func (s *imageStore) list(app core.App) (map[string]imageEntry, error) {
	names := map[string]imageEntry{}
	if s.bucket != nil {
		objects, err := s.bucket.List(armoryImagesDir + "/")
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

// entry is the stored image of a name; known is false when the storage does not hold it, and
// err says that the storage could not be listed, so whether it holds it is not known.
func (s *imageStore) entry(app core.App, name string) (e imageEntry, known bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.current(app); err != nil {
		return imageEntry{}, false, err
	}
	e, known = s.names[name]
	return e, known, nil
}

// has reports whether the storage holds the image (false while it cannot be listed).
func (s *imageStore) has(app core.App, name string) bool {
	_, known, _ := s.entry(app, name)
	return known
}

// put keeps an image under its name, written whole or not at all.
func (s *imageStore) put(app core.App, name, contentType string, image []byte) error {
	s.mu.Lock()
	bucket, err := s.current(app)
	config := s.config
	s.mu.Unlock()
	if bucket == nil && config.Enabled {
		return err
	}
	if bucket != nil {
		w, err := bucket.NewWriter(bucketKey(name), &blob.WriterOptions{ContentType: contentType, CacheControl: imageCacheControl})
		if err != nil {
			return err
		}
		if _, err := w.Write(image); err != nil {
			return errors.Join(err, w.Close())
		}
		if err := w.Close(); err != nil {
			return err
		}
	} else {
		dir := imageDir(app)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := writeImage(dir, name, image); err != nil {
			return err
		}
	}
	s.mu.Lock()
	if s.config == config && s.names != nil {
		s.names[name] = imageEntry{size: int64(len(image)), at: time.Now()}
	}
	s.mu.Unlock()
	return nil
}

// open reads a stored image, with the time it was stored.
func (s *imageStore) open(app core.App, name string) (io.ReadSeekCloser, time.Time, error) {
	s.mu.Lock()
	bucket, err := s.current(app)
	config := s.config
	s.mu.Unlock()
	if bucket == nil && config.Enabled {
		return nil, time.Time{}, err
	}
	if bucket != nil {
		r, err := bucket.GetReader(bucketKey(name))
		if err != nil {
			return nil, time.Time{}, err
		}
		return r, r.ModTime(), nil
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
	bucket, err := s.current(app)
	config := s.config
	s.mu.Unlock()
	if bucket == nil && config.Enabled {
		return err
	}
	if bucket != nil {
		err = bucket.Delete(bucketKey(name))
	} else {
		err = os.Remove(filepath.Join(imageDir(app), name))
	}
	if err != nil && !errors.Is(err, blob.ErrNotFound) && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	s.forget(name)
	return nil
}

// forget drops a name from the index, for one the storage turned out not to hold.
func (s *imageStore) forget(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.names, name)
}

// relist lists the storage again and answers every image it holds, for the nightly clean-up.
func (s *imageStore) relist(app core.App) (map[string]imageEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.names, s.failedAt = nil, time.Time{}
	if _, err := s.current(app); err != nil {
		return nil, err
	}
	out := make(map[string]imageEntry, len(s.names))
	for name, e := range s.names {
		out[name] = e
	}
	return out, nil
}

// stats counts the stored images and their bytes, and says whether they are in the S3 storage
// and why they could not be counted ("" when they could).
func (s *imageStore) stats(app core.App) (count int, size int64, offHost bool, failure string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.current(app)
	if err != nil {
		failure = message(err)
	}
	for _, e := range s.names {
		count++
		size += e.size
	}
	return count, size, s.config.Enabled, failure
}
