package odyle

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
)

// A browser's side of Web Push, with the standard library's HKDF: its keys, and the
// messages it received, decrypted.
type pushBrowser struct {
	key    *ecdh.PrivateKey
	secret []byte
	mu     sync.Mutex
	got    []pushMessage
	heads  []http.Header
	status int
}

func newPushBrowser(t *testing.T) (*pushBrowser, *httptest.Server) {
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	b := &pushBrowser{key: key, secret: make([]byte, 16), status: http.StatusCreated}
	_, _ = rand.Read(b.secret)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		message, err := b.decrypt(body)
		b.mu.Lock()
		defer b.mu.Unlock()
		if err != nil {
			t.Errorf("undecryptable push: %v", err)
		} else {
			b.got = append(b.got, message)
			b.heads = append(b.heads, r.Header.Clone())
		}
		w.WriteHeader(b.status)
	}))
	t.Cleanup(server.Close)
	allowed := pushEndpointAllowed
	pushEndpointAllowed = func(u *url.URL) bool { return allowed(u) || strings.HasPrefix(u.String(), server.URL) }
	t.Cleanup(func() { pushEndpointAllowed = allowed })
	return b, server
}

func (b *pushBrowser) decrypt(body []byte) (pushMessage, error) {
	var out pushMessage
	if len(body) < 21 {
		return out, io.ErrUnexpectedEOF
	}
	salt, size, senderPublic := body[:16], int(body[20]), body[21:21+int(body[20])]
	if binary.BigEndian.Uint32(body[16:20]) != 4096 || size != 65 {
		return out, io.ErrUnexpectedEOF
	}
	sender, err := ecdh.P256().NewPublicKey(senderPublic)
	if err != nil {
		return out, err
	}
	shared, err := b.key.ECDH(sender)
	if err != nil {
		return out, err
	}
	info := string(append(append([]byte("WebPush: info\x00"), b.key.PublicKey().Bytes()...), senderPublic...))
	ikm, err := hkdf.Key(sha256.New, shared, b.secret, info, 32)
	if err != nil {
		return out, err
	}
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, body[21+size:], nil)
	if err != nil {
		return out, err
	}
	if plain[len(plain)-1] != 2 {
		return out, io.ErrUnexpectedEOF
	}
	return out, json.Unmarshal(plain[:len(plain)-1], &out)
}

func (b *pushBrowser) received() []pushMessage {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]pushMessage(nil), b.got...)
}

func subscribe(t *testing.T, app *tests.TestApp, user string, b *pushBrowser, endpoint, language string) {
	t.Helper()
	saved(t, app, "push_subscriptions", map[string]any{"user": user, "endpoint": endpoint, "p256dh": b64.EncodeToString(b.key.PublicKey().Bytes()), "auth": b64.EncodeToString(b.secret), "language": language, "device": "Edge on Windows"})
}

func TestPushMessagesAreEncryptedForTheBrowserAndSignedWithVapid(t *testing.T) {
	app := newTestApp(t)
	browser, server := newPushBrowser(t)
	user := newUser(t, app, "Pushed")
	subscribe(t, app, user.Id, browser, server.URL+"/push/one", "cs")
	sent, err := pushToAccount(app, user.Id, defaultNotifications(), func(language string) pushMessage {
		return pushMessage{Title: pushText(language, "test"), Body: pushText(language, "testBody"), Tag: "test"}
	}, time.Hour, true)
	if err != nil || sent != 1 {
		t.Fatalf("sent %d: %v", sent, err)
	}
	got := browser.received()
	if len(got) != 1 || got[0].Title != "Oznámení Odyle fungují" {
		t.Fatalf("%+v", got)
	}
	head := browser.heads[0]
	if head.Get("Content-Encoding") != "aes128gcm" || head.Get("TTL") != "3600" || head.Get("Urgency") != "high" {
		t.Fatalf("headers %v", head)
	}
	// The VAPID JWT is for the push service's origin, signed with the key browsers subscribe with.
	token, public, _ := strings.Cut(strings.TrimPrefix(head.Get("Authorization"), "vapid t="), ", k=")
	key, err := vapid(app)
	if err != nil || public != b64.EncodeToString(key.public) {
		t.Fatalf("k=%s: %v", public, err)
	}
	parts := strings.Split(token, ".")
	claims, _ := b64.DecodeString(parts[1])
	signature, _ := b64.DecodeString(parts[2])
	verifier, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), key.public)
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err != nil || len(signature) != 64 || !ecdsa.Verify(verifier, digest[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
		t.Fatalf("signature: %v", err)
	}
	var c struct {
		Aud string `json:"aud"`
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}
	if json.Unmarshal(claims, &c) != nil || c.Aud != server.URL || c.Exp <= time.Now().Unix() || c.Sub != "https://github.com/oldbear24/odyle-dashboard" {
		t.Fatalf("claims %s", claims)
	}
	// A push service that forgot the subscription removes it; push off sends nothing.
	browser.status = http.StatusGone
	if sent, _ := pushToAccount(app, user.Id, defaultNotifications(), func(string) pushMessage { return pushMessage{Title: "x"} }, time.Hour, false); sent != 0 || countOf(t, app, "push_subscriptions") != 0 {
		t.Fatalf("sent %d, kept %d", sent, countOf(t, app, "push_subscriptions"))
	}
	off := defaultNotifications()
	off.Channels.Push = false
	if sent, _ := pushToAccount(app, user.Id, off, func(string) pushMessage { return pushMessage{} }, time.Hour, false); sent != 0 {
		t.Fatal("pushed with push off")
	}
}

func TestOnlyKnownPushServicesAreAccepted(t *testing.T) {
	for link, want := range map[string]bool{
		"https://fcm.googleapis.com/fcm/send/abc":                true,
		"https://wns2-par02p.notify.windows.com/w/?token=abc":    true,
		"https://updates.push.services.mozilla.com/wpush/v2/abc": true,
		"https://web.push.apple.com/abc":                         true,
		"http://fcm.googleapis.com/fcm/send/abc":                 false,
		"https://fcm.googleapis.com:8443/fcm/send/abc":           false,
		"https://evil.example/fcm.googleapis.com":                false,
		"https://fcm.googleapis.com.evil.example/x":              false,
		"https://10.0.0.1/push":                                  false,
		"https://user@fcm.googleapis.com/fcm/send/abc":           false,
	} {
		u, _ := url.Parse(link)
		if pushEndpointAllowed(u) != want {
			t.Errorf("%s: want %v", link, want)
		}
	}
}

func TestPushRemindsOfRunsAndTellsOfCaps(t *testing.T) {
	app := newTestApp(t)
	browser, server := newPushBrowser(t)
	lead := newUser(t, app, "PushLead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Evening", "cost": 40})
	member := saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	run := saved(t, app, "room_runs", map[string]any{"room": room.Id, "dungeon": "Fire Temple", "note": "Bring potions", "startsAt": stamp(time.Now().Add(10 * time.Minute)), "plannedBy": member.Id, "attendees": []string{member.Id}})
	subscribe(t, app, lead.Id, browser, server.URL+"/push/lead", "en")
	out, err := pushReminders(app)
	if err != nil || out.Done != 1 {
		t.Fatalf("%+v %v", out, err)
	}
	got := browser.received()
	if len(got) != 1 || !strings.HasPrefix(got[0].Title, "Fire Temple starts in ") || got[0].Body != "Evening · Bring potions" || got[0].Page != "#/room/"+room.Id || !strings.HasPrefix(got[0].Tag, run.Id+"@") || !strings.HasSuffix(got[0].Tag, "@15") {
		t.Fatalf("%+v", got)
	}
	// Once per start time; push off or quiet hours send nothing.
	if out, _ := pushReminders(app); out.Done != 0 {
		t.Fatalf("again: %+v", out)
	}
	n := defaultNotifications()
	n.Channels.Push = false
	fresh, _ := app.FindRecordById("users", lead.Id)
	fresh.Set("notifications", n)
	if err := app.Save(fresh); err != nil {
		t.Fatal(err)
	}
	moved, _ := app.FindRecordById("room_runs", run.Id)
	moved.Set("startsAt", stamp(time.Now().Add(12*time.Minute)))
	if err := app.Save(moved); err != nil {
		t.Fatal(err)
	}
	if out, _ := pushReminders(app); out.Done != 0 {
		t.Fatalf("push off: %+v", out)
	}
	// A cap alert by push, worded for the subscription.
	alert := capAlert{CharacterId: "c1", CharacterName: "Lumina", State: "soon", Base: 545, Cap: 840, Settled: true, Tick: 15, At: iso(time.Now().Add(150 * time.Minute))}
	pushCapAlert(app, lead, defaultNotifications(), alert)
	got = browser.received()
	if len(got) != 2 || got[1] != (pushMessage{Title: "Lumina caps soon", Body: "Its natural pool is full in about 3 h; each tick of 15 after that is lost.", Tag: "cap-c1-soon", Page: "#/"}) {
		t.Fatalf("%+v", got)
	}
	if m := capAlertPush("cs", capAlert{CharacterName: "Lumina", State: "full", Cap: 560, Tick: 15}, time.Now()); m.Body != "Přirozená zásoba je na 560: pokud je to její strop, každých 15 propadá." {
		t.Fatal(m.Body)
	}
}

func TestBrowsersTurnPushOnAndOff(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Subscriber")
	raw, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	auth := map[string]string{"Authorization": raw}
	reuse := func(testing.TB) *tests.TestApp { return app }
	key, _ := ecdh.P256().GenerateKey(rand.Reader)
	p256dh := b64.EncodeToString(key.PublicKey().Bytes())
	good := `{"endpoint":"https://fcm.googleapis.com/fcm/send/abc","keys":{"p256dh":"` + p256dh + `","auth":"` + b64.EncodeToString(make([]byte, 16)) + `"},"language":"cs","device":"Chrome on Android"}`
	for _, s := range []tests.ApiScenario{
		{Name: "an unknown push service is refused", Method: http.MethodPost, URL: "/api/odyle/push-subscribe", Headers: auth,
			Body: strings.NewReader(`{"endpoint":"https://10.0.0.1/push","keys":{"p256dh":"` + p256dh + `","auth":"AAAAAAAAAAAAAAAAAAAAAA"}}`), ExpectedStatus: 400, ExpectedContent: []string{"This browser's push service is not supported."}},
		{Name: "bad keys are refused", Method: http.MethodPost, URL: "/api/odyle/push-subscribe", Headers: auth,
			Body: strings.NewReader(`{"endpoint":"https://fcm.googleapis.com/fcm/send/abc","keys":{"p256dh":"AAAA","auth":"AAAA"}}`), ExpectedStatus: 400, ExpectedContent: []string{"The push subscription's keys are not valid."}},
		{Name: "a browser turns push on", Method: http.MethodPost, URL: "/api/odyle/push-subscribe", Headers: auth, Body: strings.NewReader(good),
			ExpectedStatus: 200, ExpectedContent: []string{`"device":"Chrome on Android"`, `"publicKey":"B`}},
		{Name: "the account page lists it with the server's key", Method: http.MethodGet, URL: "/api/odyle/account", Headers: auth,
			ExpectedStatus: 200, ExpectedContent: []string{`"push":{`, `"device":"Chrome on Android"`}, NotExpectedContent: []string{"fcm.googleapis.com"}},
		{Name: "the export has it", Method: http.MethodGet, URL: "/api/odyle/export", Headers: auth,
			ExpectedStatus: 200, ExpectedContent: []string{`"pushSubscriptions":[{`, `fcm.googleapis.com/fcm/send/abc`}},
		{Name: "a test with no device that takes it says so", Method: http.MethodPost, URL: "/api/odyle/push-unsubscribe", Headers: auth,
			Body: strings.NewReader(`{"endpoint":"https://fcm.googleapis.com/fcm/send/abc"}`), ExpectedStatus: 200, ExpectedContent: []string{`"devices":[]`}},
		{Name: "a test without devices", Method: http.MethodPost, URL: "/api/odyle/push-test", Headers: auth, Body: strings.NewReader(`{}`),
			ExpectedStatus: 400, ExpectedContent: []string{"No device of this account takes push notifications."}},
	} {
		s.TestAppFactory, s.DisableTestAppCleanup = reuse, true
		s.Test(t)
	}
}
