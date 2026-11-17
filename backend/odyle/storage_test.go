package odyle

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
)

// fakeS3 stands in for an S3-compatible storage at a path-style address: one bucket whose
// objects are put, read (ranges and conditions as net/http serves them), listed and deleted.
// reads counts the objects read or asked about.
type fakeS3 struct {
	mu         sync.Mutex
	bucket     string
	objects    map[string]fakeObject
	reads      atomic.Int32
	url        string
	beforeList func() // runs after a listing read the objects and before it answers
}

type fakeObject struct {
	body                      []byte
	contentType, cacheControl string
	at                        time.Time
}

func newFakeS3(t *testing.T) *fakeS3 {
	f := &fakeS3{bucket: "odyle-files", objects: map[string]fakeObject{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rest, ok := strings.CutPrefix(r.URL.Path, "/"+f.bucket)
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		key := strings.TrimPrefix(rest, "/")
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case key == "" && r.Method == http.MethodGet:
			type content struct {
				Key          string
				LastModified string
				ETag         string
				Size         int64
			}
			out := struct {
				XMLName     xml.Name `xml:"ListBucketResult"`
				Name        string
				Prefix      string
				KeyCount    int
				IsTruncated bool
				Contents    []content
			}{Name: f.bucket, Prefix: r.URL.Query().Get("prefix")}
			keys := []string{}
			for k := range f.objects {
				if strings.HasPrefix(k, out.Prefix) {
					keys = append(keys, k)
				}
			}
			sort.Strings(keys)
			for _, k := range keys {
				o := f.objects[k]
				out.Contents = append(out.Contents, content{Key: k, LastModified: o.at.UTC().Format(time.RFC3339), ETag: `"etag"`, Size: int64(len(o.body))})
			}
			out.KeyCount = len(keys)
			if wait := f.beforeList; wait != nil {
				f.mu.Unlock()
				wait()
				f.mu.Lock()
			}
			w.Header().Set("Content-Type", "application/xml")
			xml.NewEncoder(w).Encode(out)
		case r.Method == http.MethodPut:
			body, _ := io.ReadAll(r.Body)
			f.objects[key] = fakeObject{body: body, contentType: r.Header.Get("Content-Type"), cacheControl: r.Header.Get("Cache-Control"), at: time.Now()}
			w.Header().Set("ETag", `"etag"`)
		case r.Method == http.MethodGet || r.Method == http.MethodHead:
			f.reads.Add(1)
			o, ok := f.objects[key]
			if !ok {
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(http.StatusNotFound)
				if r.Method == http.MethodGet {
					w.Write([]byte(`<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`))
				}
				return
			}
			w.Header().Set("Content-Type", o.contentType)
			w.Header().Set("ETag", `"etag"`)
			http.ServeContent(w, r, key, o.at, bytes.NewReader(o.body))
		case r.Method == http.MethodDelete:
			delete(f.objects, key)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(server.Close)
	f.url = server.URL
	return f
}

// object is a stored object and whether the bucket holds it.
func (f *fakeS3) object(key string) (fakeObject, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.objects[key]
	return o, ok
}

// keys are the objects' keys under the prefix, sorted.
func (f *fakeS3) keys(prefix string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []string{}
	for k := range f.objects {
		if strings.HasPrefix(k, prefix) {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

// useStorage points ODYLE_STORAGE_S3_* at the fake and applies them, as a start does.
func (f *fakeS3) useStorage(t *testing.T, app core.App) {
	t.Helper()
	for name, value := range map[string]string{"BUCKET": f.bucket, "REGION": "eu-central-1", "ENDPOINT": f.url, "ACCESS_KEY": "key", "SECRET": "secret", "FORCE_PATH_STYLE": "true"} {
		t.Setenv("ODYLE_STORAGE_S3_"+name, value)
	}
	if problem := configureStorage(app); problem != "" || !app.Settings().S3.Enabled {
		t.Fatalf("the storage was not applied: %q", problem)
	}
}

// ODYLE_STORAGE_S3_* set PocketBase's file storage, and what is missing or wrong is named while
// files stay where they are.
func TestS3FileStorageComesFromTheEnvironment(t *testing.T) {
	app := newTestApp(t)
	if problem := configureStorage(app); problem != "" || app.Settings().S3.Enabled {
		t.Fatalf("without variables: %q", problem)
	}
	t.Setenv("ODYLE_STORAGE_S3_BUCKET", "odyle-files")
	if problem := configureStorage(app); !strings.Contains(problem, "ODYLE_STORAGE_S3_REGION, ODYLE_STORAGE_S3_ENDPOINT, ODYLE_STORAGE_S3_ACCESS_KEY, ODYLE_STORAGE_S3_SECRET") || app.Settings().S3.Enabled {
		t.Fatalf("incomplete: %q", problem)
	}
	f := newFakeS3(t)
	f.useStorage(t, app)
	if got := app.Settings().S3; got.Bucket != "odyle-files" || got.Endpoint != f.url || !got.ForcePathStyle || got.Secret != "secret" {
		t.Fatalf("storage = %+v", got)
	}
	status := asJSON(t, storageStatus(app))
	if !strings.Contains(status, `"offHost":true`) || !strings.Contains(status, `"bucket":"odyle-files"`) || strings.Contains(status, "secret") {
		t.Fatalf("status = %s", status)
	}
}

// Once the S3 storage is on, the files kept on disk move into it: the characters' portraits and
// the armory's images, each uploaded and then deleted from the disk. The image route then serves
// them from the bucket with the same caching, a browser asking whether one changed is told it did
// not without the bucket being asked, and a name the server does not keep is not looked for.
func TestFilesOnDiskMoveIntoTheS3Storage(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	dir := imageDir(app)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	icon, photo := pngOf(t, 64), pngOf(t, 80)
	for name, content := range map[string][]byte{"Icon_Moved.png": icon, "portrait-moved.png": photo, ".download-123": []byte("cut off")} {
		if err := os.WriteFile(filepath.Join(dir, name), content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	owner := newUser(t, app, "Pictured")
	c, err := newRecord(app, "characters")
	if err != nil {
		t.Fatal(err)
	}
	file, err := filesystem.NewFileFromBytes(photo, "portrait.png")
	if err != nil {
		t.Fatal(err)
	}
	c.Set("user", owner.Id)
	c.Set("characterName", "Pictured")
	c.Set("server", "Lumiel")
	c.Set("region", "GLOBAL_EU")
	c.Set("portrait", file)
	if err := app.Save(c); err != nil {
		t.Fatal(err)
	}
	portraitKey := c.BaseFilesPath() + "/" + c.GetString("portrait")
	if _, err := os.Stat(filepath.Join(app.DataDir(), core.LocalStorageDirName, portraitKey)); err != nil {
		t.Fatalf("the portrait is not on disk: %v", err)
	}

	f := newFakeS3(t)
	f.useStorage(t, app)
	move := moveToBucket(app)
	if move.Files != 3 || move.Failed != 0 || move.Error != "" {
		t.Fatalf("move %+v", move)
	}
	if got := f.keys(armoryImagesDir + "/"); strings.Join(got, ",") != "armory_images/Icon_Moved.png,armory_images/portrait-moved.png" {
		t.Fatalf("the bucket holds %v", got)
	}
	if o, ok := f.object("armory_images/Icon_Moved.png"); !ok || !bytes.Equal(o.body, icon) || o.contentType != "image/png" || o.cacheControl != imageCacheControl {
		t.Fatalf("the moved icon: %v %q %q", ok, o.contentType, o.cacheControl)
	}
	if o, ok := f.object(portraitKey); !ok || !bytes.Equal(o.body, photo) {
		t.Fatalf("the portrait %s is not in the bucket", portraitKey)
	}
	if exists(dir) {
		t.Fatal("pb_data/armory_images is still there")
	}
	if _, err := os.Stat(filepath.Join(app.DataDir(), core.LocalStorageDirName, portraitKey)); err == nil {
		t.Fatal("the portrait is still on disk")
	}
	if again := moveToBucket(app); again.Files != 0 || again.Failed != 0 {
		t.Fatalf("a second move %+v", again)
	}

	// Served from the bucket, kept a year; a browser asking again hears it did not change.
	body, headers := fetch(t, app, "/api/odyle/armory-images/Icon_Moved.png", 200)
	if !bytes.Equal(body, icon) || headers.Get("Cache-Control") != imageCacheControl || headers.Get("Content-Type") != "image/png" || headers.Get("ETag") != `"Icon_Moved.png"` {
		t.Fatalf("served %d bytes, %v", len(body), headers)
	}
	reads := f.reads.Load()
	for _, condition := range []map[string]string{{"If-None-Match": `"Icon_Moved.png"`}, {"If-Modified-Since": time.Now().Add(time.Minute).UTC().Format(http.TimeFormat)}} {
		(&tests.ApiScenario{Name: "conditional GET", Method: http.MethodGet, URL: "/api/odyle/armory-images/Icon_Moved.png", Headers: condition, ExpectedStatus: http.StatusNotModified,
			ExpectedContent: []string{""}, TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true}).Test(t)
	}
	fetch(t, app, "/api/odyle/armory-images/Icon_Unknown.png", 404)
	if f.reads.Load() != reads {
		t.Fatalf("the bucket was asked %d times", f.reads.Load()-reads)
	}
	// PocketBase serves the portrait from the bucket too.
	if body, _ := fetch(t, app, "/api/files/"+portraitKey, 200); !bytes.Equal(body, photo) {
		t.Fatal("the portrait was not served from the bucket")
	}
	if status := armoryStatus(app); status["images"] != 2 || status["imagesOffHost"] != true || status["imagesError"] != "" {
		t.Fatalf("status %v", status)
	}
}

// In the S3 storage, a lookup keeps the images it downloads in the bucket, knows the ones there
// without asking for each, and the nightly clean-up deletes those no profile names.
func TestArmoryKeepsItsImagesInTheS3Storage(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	f := newFakeS3(t)
	f.useStorage(t, app)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	stateOf(app).armory.wait()
	kept := f.keys(armoryImagesDir + "/")
	// Six images of the profile and the emblems of the Chanter and the Spiritmaster.
	if len(kept) != 8 || exists(imageDir(app)) {
		t.Fatalf("the bucket holds %v", kept)
	}
	body, _ := fetch(t, app, "/api/odyle/armory-images/ICON_CL_SKILL_001.png", 200)
	if o, _ := f.object("armory_images/ICON_CL_SKILL_001.png"); !bytes.Equal(body, o.body) {
		t.Fatal("the icon served is not the one in the bucket")
	}
	// The next lookup asks the bucket for nothing it knows it holds.
	images, reads := stand.images.Load(), f.reads.Load()
	if _, err := app.DB().NewQuery("UPDATE armory_profiles SET fetchedAt = {:at}").Bind(dbx.Params{"at": ago(7 * time.Hour)}).Execute(); err != nil {
		t.Fatal(err)
	}
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	stateOf(app).armory.wait()
	if got := stand.images.Load() - images; got != 2 || f.reads.Load() != reads {
		t.Fatalf("%d images downloaded again, the bucket asked %d times", got, f.reads.Load()-reads)
	}
	// An image no profile names goes once it is an hour old.
	f.mu.Lock()
	f.objects["armory_images/Old.png"] = fakeObject{body: tinyPNG(t), contentType: "image/png", at: time.Now().Add(-2 * time.Hour)}
	f.objects["armory_images/New.png"] = fakeObject{body: tinyPNG(t), contentType: "image/png", at: time.Now()}
	f.mu.Unlock()
	if _, err := cleanArmory(app); err != nil {
		t.Fatal(err)
	}
	if _, old := f.object("armory_images/Old.png"); old {
		t.Fatal("an old image no profile names was kept")
	}
	if _, fresh := f.object("armory_images/New.png"); !fresh || len(f.keys(armoryImagesDir+"/")) != 9 {
		t.Fatalf("the bucket holds %v", f.keys(armoryImagesDir+"/"))
	}
}

func tinyPNG(t *testing.T) []byte { return pngOf(t, 16) }

// A kept profile that names an image the server no longer keeps (after a restore, or a change of
// the file storage) is fetched again once it is 15 minutes old, which keeps its images again.
func TestProfilesNamingLostImagesAreFetchedAgain(t *testing.T) {
	fastArmory(t)
	stand := &armoryStand{}
	stand.serve(t)
	app := newTestApp(t)
	const id = "kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4="
	ask(t, app, "GET", armoryPath(id), nil, "", 200)
	stateOf(app).armory.wait()
	age := func(d time.Duration) {
		t.Helper()
		if _, err := app.DB().NewQuery("UPDATE armory_profiles SET fetchedAt = {:at}").Bind(dbx.Params{"at": ago(d)}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	age(20 * time.Minute)
	if got := ask(t, app, "GET", armoryPath(id), nil, "", 200); got["state"] != "fresh" {
		t.Fatalf("a profile with its images: %v", got["state"])
	}
	if err := imagesOf(app).remove(app, "ICON_CL_SKILL_001.png"); err != nil {
		t.Fatal(err)
	}
	age(5 * time.Minute)
	if got := ask(t, app, "GET", armoryPath(id), nil, "", 200); got["state"] != "fresh" {
		t.Fatalf("a profile 5 minutes old: %v", got["state"])
	}
	age(20 * time.Minute)
	if got := ask(t, app, "GET", armoryPath(id), nil, "", 200); got["state"] == "fresh" {
		t.Fatal("a profile missing an image was not fetched again")
	}
	stateOf(app).armory.wait()
	if !imagesOf(app).has(app, "ICON_CL_SKILL_001.png") {
		t.Fatal("the lost image was not kept again")
	}
}

// A portrait the file storage lost is downloaded again by the next lookup, though PLAYNC's image
// did not change.
func TestLostPortraitsAreKeptAgain(t *testing.T) {
	stand := &plaync{}
	stand.serve(t)
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	id := newGameCharacter(t, app, newUser(t, app, "Lost").Id, "Lost")
	if err := gamePortrait(app, id); err != nil {
		t.Fatal(err)
	}
	c, _ := findAs[Character](app, "characters", id)
	first := c.Portrait()
	if first == "" || !portraitStored(app, c) {
		t.Fatal("no portrait")
	}
	if err := os.Remove(filepath.Join(app.DataDir(), core.LocalStorageDirName, c.BaseFilesPath(), first)); err != nil {
		t.Fatal(err)
	}
	if portraitStored(app, c) {
		t.Fatal("a removed portrait counts as stored")
	}
	if err := gamePortrait(app, id); err != nil {
		t.Fatal(err)
	}
	again, _ := findAs[Character](app, "characters", id)
	if again.Portrait() == "" || again.Portrait() == first || !portraitStored(app, again) {
		t.Fatalf("the portrait %q was not kept again", again.Portrait())
	}
}

// A move sticks to the storage that was on when it started: once the file storage is another
// (switched off, or another bucket), it stops and leaves the rest on disk.
func TestAMoveStopsWhenTheStorageChanges(t *testing.T) {
	app := newTestApp(t)
	dir := imageDir(app)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"Icon_A.png", "Icon_B.png"} {
		if err := os.WriteFile(filepath.Join(dir, name), tinyPNG(t), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	f := newFakeS3(t)
	f.useStorage(t, app)
	other := app.Settings().S3
	other.Bucket = "another-bucket"
	move := moveInto(app, other)
	if move.Files != 0 || !strings.Contains(move.Error, "changed") || len(f.keys("")) != 0 {
		t.Fatalf("a move to a storage no longer on: %+v, the bucket holds %v", move, f.keys(""))
	}
	if left, _ := os.ReadDir(dir); len(left) != 2 {
		t.Fatalf("%d images left on disk", len(left))
	}
	if move := moveToBucket(app); move.Files != 2 || move.Error != "" {
		t.Fatalf("the move %+v", move)
	}
}

// Nothing waits for a listing of the bucket but the call that runs it: meanwhile the index says it
// cannot tell, an image kept during the listing is in the index after it, and a listing that
// does not end in time fails instead of holding the index.
func TestTheImageIndexNeverWaitsForAListing(t *testing.T) {
	app := newTestApp(t)
	f := newFakeS3(t)
	f.useStorage(t, app)
	gate, listed := make(chan struct{}), make(chan struct{}, 1)
	f.beforeList = func() { listed <- struct{}{}; <-gate }
	store := imagesOf(app)
	first := make(chan error, 1)
	go func() {
		_, _, err := store.entry(app, "Icon_Late.png")
		first <- err
	}()
	<-listed
	if _, known, err := store.entry(app, "Icon_Late.png"); known || !errors.Is(err, errImagesListing) {
		t.Fatalf("during the listing: %v %v", known, err)
	}
	if _, _, _, failure := store.stats(app); failure == "" {
		t.Fatal("the status does not say the images are being listed")
	}
	if err := store.put(app, "Icon_Late.png", "image/png", tinyPNG(t)); err != nil {
		t.Fatal(err)
	}
	close(gate)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	if !store.has(app, "Icon_Late.png") {
		t.Fatal("an image kept during the listing is not in the index")
	}

	// A bucket that does not answer: the listing gives up, and the index says why.
	timeouts := bucketTimeouts
	bucketTimeouts.list = 100 * time.Millisecond
	t.Cleanup(func() { bucketTimeouts = timeouts })
	stuck := make(chan struct{})
	t.Cleanup(func() { close(stuck) })
	f.beforeList = func() { <-stuck }
	start := time.Now()
	if _, err := store.relist(app); err == nil || time.Since(start) > 5*time.Second {
		t.Fatalf("a listing that never ends: %v after %v", err, time.Since(start))
	}
}
