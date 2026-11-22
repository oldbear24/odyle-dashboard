package odyle

import (
	"bytes"
	"fmt"
	"hash/crc32"
	"image"
	"image/png"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/subscriptions"
)

// A truncated or corrupt PNG is refused without a panic, also when its header says it already fits,
// and a header that claims a huge picture is never decoded.
func TestShrinkIconRefusesTruncatedAndCorruptPNGs(t *testing.T) {
	big := pngOf(t, 512)
	for name, icon := range map[string][]byte{
		"nothing":                       nil,
		"the signature only":            big[:8],
		"a cut header":                  big[:20],
		"the header only":               big[:33],
		"cut inside the picture":        big[:len(big)/2],
		"the end chunk missing":         big[:len(big)-12],
		"not a PNG":                     []byte("GIF89a not an image at all"),
		"a JPEG":                        jpegOf(t),
		"a picture of flipped bytes":    flipped(big, len(big)/3),
		"a header with a wrong CRC":     flipped(big, 20),
		"a header claiming a huge size": hugeHeader(),
	} {
		t.Run(name, func(t *testing.T) {
			out, err := shrinkIcon(icon)
			if err == nil {
				t.Fatalf("accepted %d bytes, gave %d bytes", len(icon), len(out))
			}
		})
	}
	// The icons that do fit stay as they are, once they decode whole.
	small := pngOf(t, 64)
	t.Run("a truncated icon that already fits", func(t *testing.T) {
		if _, err := shrinkIcon(small[:len(small)-20]); err == nil {
			t.Fatal("a truncated icon was kept")
		}
	})
	if out, err := shrinkIcon(small); err != nil || !bytes.Equal(out, small) {
		t.Fatalf("a whole small icon: %v", err)
	}
}

// flipped is icon with the byte at the position inverted.
func flipped(icon []byte, at int) []byte {
	out := bytes.Clone(icon)
	out[at] ^= 0xff
	return out
}

// hugeHeader is a PNG header that claims 60,000 by 60,000 pixels, with no picture after it.
func hugeHeader() []byte {
	var out bytes.Buffer
	out.WriteString("\x89PNG\r\n\x1a\n")
	// IHDR: 60000 x 60000, 8 bits, RGBA; the CRC is valid, so only its size can refuse it.
	chunk := []byte("IHDR\x00\x00\xea\x60\x00\x00\xea\x60\x08\x06\x00\x00\x00")
	out.Write([]byte{0, 0, 0, 13})
	out.Write(chunk)
	crc := crc32.ChecksumIEEE(chunk)
	out.Write([]byte{byte(crc >> 24), byte(crc >> 16), byte(crc >> 8), byte(crc)})
	return out.Bytes()
}

// shrinkIcon takes any bytes: no panic, and what it keeps is a PNG that fits.
func FuzzShrinkIcon(f *testing.F) {
	whole := pngOfSize(f, 300, 150)
	f.Add(whole)
	f.Add(whole[:len(whole)/2])
	f.Add(pngOfSize(f, 64, 64))
	f.Add(hugeHeader())
	f.Add([]byte("\x89PNG\r\n\x1a\n"))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, icon []byte) {
		out, err := shrinkIcon(icon)
		if err != nil {
			return
		}
		config, err := png.DecodeConfig(bytes.NewReader(out))
		if err != nil || config.Width > iconSize || config.Height > iconSize {
			t.Fatalf("kept %v %v", config, err)
		}
	})
}

// A client that takes nothing is held in a bounded queue and one goroutine; the others hear
// every delivery at once, however many there are.
func TestAStalledRealtimeClientDoesNotHoldUpTheOthers(t *testing.T) {
	app := newTestApp(t)
	lead, mate := newUser(t, app, "Lead"), newUser(t, app, "Mate")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	shared := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Shared", "server": "Lumiel", "region": "GLOBAL_EU"})
	sharingMember(t, app, map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"}, shared.Id)
	deliver(app)
	topic := roomTopic + room.Id

	connect := func(user *core.Record) *subscriptions.DefaultClient {
		c := subscriptions.NewDefaultClient()
		c.Set(apis.RealtimeClientAuthKey, user)
		c.Subscribe(topic)
		app.SubscriptionsBroker().Register(c)
		return c
	}
	stalled, healthy := connect(lead), connect(mate)
	var heard atomic.Int64
	go func() {
		for range healthy.Channel() {
			heard.Add(1)
		}
	}()
	t.Cleanup(func() { stalled.Unsubscribe(); healthy.Unsubscribe() })

	before := runtime.NumGoroutine()
	const changes = 3 * queueLimit
	started := time.Now()
	for i := range changes {
		shared.Set("value", 100+i)
		shared.Set("confirmed", true)
		if err := app.Save(shared); err != nil {
			t.Fatal(err)
		}
		deliver(app)
	}
	if took := time.Since(started); took > 20*time.Second {
		t.Fatalf("%d deliveries took %v with a client that takes nothing", changes, took)
	}
	deadline := time.Now().Add(5 * time.Second)
	for heard.Load() < changes && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if got := heard.Load(); got < changes {
		t.Fatalf("the healthy client heard %d of %d", got, changes)
	}
	if n := outgoing.waiting(stalled.Id()); n > queueLimit {
		t.Fatalf("%d messages wait for the stalled client", n)
	}
	if grown := runtime.NumGoroutine() - before; grown > 10 {
		t.Fatalf("%d goroutines more: one per message?", grown)
	}
	// Once it goes, its queue goes with it.
	stalled.Discard()
	deadline = time.Now().Add(5 * time.Second)
	for outgoing.waiting(stalled.Id()) > 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := outgoing.waiting(stalled.Id()); n != 0 {
		t.Fatalf("%d messages wait for a client that went", n)
	}
}

// Of any number of runs started together, one runs; a run that panics frees its job; a job
// that overran any time still holds its lock, and the end of an earlier run never frees the
// lock a later one holds.
func TestAJobsLockHoldsAgainstManyRunsAndOverruns(t *testing.T) {
	app := newTestApp(t)
	var started atomic.Int64
	release := make(chan struct{})
	swapJob(t, "odyle-stats", func(core.App) (result, error) {
		started.Add(1)
		<-release
		return result{Done: 1}, nil
	})
	var wg sync.WaitGroup
	outs := make([]result, 20)
	for i := range outs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			outs[i] = runJob(app, "odyle-stats", i%2 == 0)
		}()
	}
	// Those that lost have answered; the one that runs waits for the release.
	deadline := time.Now().Add(5 * time.Second)
	skipped := func() int {
		n := 0
		for i := range outs {
			if outs[i].Skipped == "running" {
				n++
			}
		}
		return n
	}
	for time.Now().Before(deadline) && started.Load() == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	s := stateOf(app)
	// A run that began hours ago still holds it; another run takes over its job (as a restart of
	// the state would) and the first one's end leaves that lock alone.
	s.mu.Lock()
	first := s.running["odyle-stats"]
	s.running["odyle-stats"] = jobRun{id: first.id + 1000, started: time.Now().Add(-3 * time.Hour)}
	s.mu.Unlock()
	if out := runJob(app, "odyle-stats", true); out.Skipped != "running" {
		t.Fatalf("a run started under a lock held for hours: %+v", out)
	}
	close(release)
	wg.Wait()
	if got := started.Load(); got != 1 {
		t.Fatalf("%d runs started together", got)
	}
	done := 0
	for _, o := range outs {
		if o.Done == 1 {
			done++
		}
	}
	if done != 1 || skipped() != 19 {
		t.Fatalf("%d ran, %d skipped: %+v", done, skipped(), outs)
	}
	s.mu.Lock()
	held, still := s.running["odyle-stats"]
	delete(s.running, "odyle-stats")
	s.mu.Unlock()
	if !still || held.id != first.id+1000 {
		t.Fatalf("the earlier run lifted a later run's lock: %+v (%v)", held, still)
	}

	// A panic frees the job and is the run's failure.
	swapJob(t, "odyle-stats", func(core.App) (result, error) { panic("boom") })
	if out := runJob(app, "odyle-stats", false); out.Failed != 1 || out.Error != "boom" {
		t.Fatalf("a panic: %+v", out)
	}
	swapJob(t, "odyle-stats", func(core.App) (result, error) { return result{Done: 2}, nil })
	if out := runJob(app, "odyle-stats", false); out.Done != 2 || out.Skipped != "" {
		t.Fatalf("the lock stayed after a panic: %+v", out)
	}
}

// The expiry job ends expired reader sessions 500 to a run (the most the listing of one run
// holds), not a database's worth in one write; the characters they read turn stale and a
// session still open stays.
func TestTheExpiryJobEndsFiveHundredSessionsPerRun(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Backlog")
	for i := 0; i < 520; i++ {
		saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(-60 - i)})
	}
	open := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(3600)})
	last := saved(t, app, "characters", map[string]any{"user": player.Id, "characterName": "Reader", "server": "Lumiel", "region": "GLOBAL_EU", "valid": true, "value": 50, "confirmed": true, "readingSession": open.Id})
	first, err := cleanup(app)
	if err != nil || first.Done != 500 {
		t.Fatalf("the first run ended %d (%v)", first.Done, err)
	}
	if n := countOf(t, app, "publisher_sessions"); n != 21 {
		t.Fatalf("%d sessions after the first run, want 21", n)
	}
	second, err := cleanup(app)
	if err != nil || second.Done != 20 {
		t.Fatalf("the second run ended %d (%v)", second.Done, err)
	}
	if n := countOf(t, app, "publisher_sessions"); n != 1 {
		t.Fatalf("%d sessions after the second run", n)
	}
	if again, err := cleanup(app); err != nil || again.Done != 0 {
		t.Fatalf("a third run: %+v (%v)", again, err)
	}
	if c := characterRecord(t, app, last.Id); !c.GetBool("valid") || c.GetString("readingSession") != open.Id {
		t.Fatalf("a character of an open session changed: %v", fmt.Sprint(c.GetBool("valid")))
	}
}

// pngOfSize is a PNG of the given size.
func pngOfSize(t testing.TB, width, height int) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := png.Encode(&out, image.NewNRGBA(image.Rect(0, 0, width, height))); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
