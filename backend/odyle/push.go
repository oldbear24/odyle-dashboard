package odyle

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Web Push: planned-run reminders and cap alerts reach a browser or installed app with the
// dashboard closed. A browser that turns push on for the account (Account & data →
// Notifications) subscribes at its push service (Google, Mozilla, Apple or Microsoft) and
// sends the endpoint and keys here (push_subscriptions). The backend encrypts each message
// for that browser alone (RFC 8291, aes128gcm), signs the request with its VAPID key (RFC
// 8292) and posts it to the endpoint; the push service only passes the ciphertext on. The
// VAPID key is ODYLE_VAPID_PRIVATE_KEY (a P-256 private key, base64url) or one generated
// once into the data directory (odyle_vapid.key, so backups keep it). Only endpoints of
// the known push services are accepted, so the server never posts anywhere else.

var b64 = base64.RawURLEncoding

// pushHosts are the push services browsers use: Chrome, Edge (WNS), Firefox, Safari.
var pushHosts = []string{"fcm.googleapis.com", "notify.windows.com", "push.services.mozilla.com", "push.apple.com"}

// pushEndpointAllowed says whether the backend may post to an endpoint (push_testing.go adds
// the test server in test builds).
var pushEndpointAllowed = func(endpoint *url.URL) bool {
	if endpoint.Scheme != "https" || endpoint.User != nil || endpoint.Port() != "" && endpoint.Port() != "443" {
		return false
	}
	host := strings.ToLower(endpoint.Hostname())
	for _, allowed := range pushHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return true
		}
	}
	return false
}

type vapidKey struct {
	private *ecdsa.PrivateKey
	public  []byte // the uncompressed point clients subscribe with
}

var vapidOnce struct {
	sync.Mutex
	key *vapidKey
}

// vapid loads, or once creates, the backend's VAPID key.
func vapid(app core.App) (*vapidKey, error) {
	vapidOnce.Lock()
	defer vapidOnce.Unlock()
	if vapidOnce.key != nil {
		return vapidOnce.key, nil
	}
	raw := strings.TrimSpace(os.Getenv("ODYLE_VAPID_PRIVATE_KEY"))
	path := filepath.Join(app.DataDir(), "odyle_vapid.key")
	if raw == "" {
		if saved, err := os.ReadFile(path); err == nil {
			raw = strings.TrimSpace(string(saved))
		}
	}
	var private *ecdsa.PrivateKey
	if raw != "" {
		scalar, err := b64.DecodeString(strings.TrimRight(raw, "="))
		if err != nil {
			return nil, errors.New("the VAPID key is not base64url")
		}
		if private, err = ecdsa.ParseRawPrivateKey(elliptic.P256(), scalar); err != nil {
			return nil, fmt.Errorf("the VAPID key is not a P-256 private key: %w", err)
		}
	} else {
		var err error
		if private, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader); err != nil {
			return nil, err
		}
		scalar, err := private.Bytes()
		if err != nil {
			return nil, err
		}
		if err := os.WriteFile(path, []byte(b64.EncodeToString(scalar)+"\n"), 0o600); err != nil {
			return nil, err
		}
	}
	public, err := private.PublicKey.Bytes()
	if err != nil {
		return nil, err
	}
	vapidOnce.key = &vapidKey{private: private, public: public}
	return vapidOnce.key, nil
}

// vapidHeader is the Authorization header for an endpoint: a JWT (ES256) for the push
// service's origin, valid for 12 hours, with the contact the push service may use.
func (k *vapidKey) header(endpoint *url.URL, subject string, at time.Time) (string, error) {
	head := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, err := json.Marshal(map[string]any{"aud": endpoint.Scheme + "://" + endpoint.Host, "exp": at.Add(12 * time.Hour).Unix(), "sub": subject})
	if err != nil {
		return "", err
	}
	signed := head + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signed))
	r, s, err := ecdsa.Sign(rand.Reader, k.private, digest[:])
	if err != nil {
		return "", err
	}
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	s.FillBytes(signature[32:])
	return "vapid t=" + signed + "." + b64.EncodeToString(signature) + ", k=" + b64.EncodeToString(k.public), nil
}

func hkdfExtract(salt, secret []byte) []byte {
	mac := hmac.New(sha256.New, salt)
	mac.Write(secret)
	return mac.Sum(nil)
}

// hkdfExpand for up to 32 bytes: one block.
func hkdfExpand(prk, info []byte, size int) []byte {
	mac := hmac.New(sha256.New, prk)
	mac.Write(info)
	mac.Write([]byte{1})
	return mac.Sum(nil)[:size]
}

// encryptPush encrypts a message for one subscription (RFC 8291) with a new key and salt:
// the body is the aes128gcm header (salt, record size, the sender's public key) and one record.
func encryptPush(message, clientPublic, authSecret []byte, sender *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	client, err := ecdh.P256().NewPublicKey(clientPublic)
	if err != nil {
		return nil, errors.New("the subscription's key is not a P-256 public key")
	}
	shared, err := sender.ECDH(client)
	if err != nil {
		return nil, err
	}
	senderPublic := sender.PublicKey().Bytes()
	info := append(append([]byte("WebPush: info\x00"), clientPublic...), senderPublic...)
	ikm := hkdfExpand(hkdfExtract(authSecret, shared), info, 32)
	prk := hkdfExtract(salt, ikm)
	block, err := aes.NewCipher(hkdfExpand(prk, []byte("Content-Encoding: aes128gcm\x00"), 16))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	header := make([]byte, 0, 21+len(senderPublic))
	header = append(header, salt...)
	header = binary.BigEndian.AppendUint32(header, 4096)
	header = append(header, byte(len(senderPublic)))
	header = append(header, senderPublic...)
	return gcm.Seal(header, hkdfExpand(prk, []byte("Content-Encoding: nonce\x00"), 12), append(bytes.Clone(message), 2), nil), nil
}

// pushMessage is what the service worker shows (public/sw.js).
type pushMessage struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Tag   string `json:"tag"`
	Page  string `json:"page,omitempty"` // a dashboard page to open, "#/…"
}

var pushClient = &http.Client{Timeout: 10 * time.Second}

// errPushGone: the push service no longer knows the subscription (404 or 410).
var errPushGone = errors.New("the push service forgot this subscription")

// sendPush posts one message to one subscription; urgent messages (run reminders) ask the
// push service to deliver at once, and every message is dropped after ttl.
func sendPush(app core.App, sub *core.Record, message pushMessage, ttl time.Duration, urgent bool) error {
	endpoint, err := url.Parse(sub.GetString("endpoint"))
	if err != nil || !pushEndpointAllowed(endpoint) {
		return errPushGone
	}
	key, err := vapid(app)
	if err != nil {
		return err
	}
	clientPublic, err1 := b64.DecodeString(strings.TrimRight(sub.GetString("p256dh"), "="))
	authSecret, err2 := b64.DecodeString(strings.TrimRight(sub.GetString("auth"), "="))
	if err1 != nil || err2 != nil || len(authSecret) != 16 {
		return errPushGone
	}
	sender, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	text, err := json.Marshal(message)
	if err != nil {
		return err
	}
	body, err := encryptPush(text, clientPublic, authSecret, sender, salt)
	if err != nil {
		return errPushGone
	}
	authorization, err := key.header(endpoint, pushSubject(app), time.Now())
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Encoding", "aes128gcm")
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("TTL", fmt.Sprint(int(ttl.Seconds())))
	if urgent {
		request.Header.Set("Urgency", "high")
	}
	response, err := pushClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	switch {
	case response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone:
		return errPushGone
	case response.StatusCode >= 300:
		return fmt.Errorf("the push service answered %d", response.StatusCode)
	}
	_, err = app.DB().NewQuery("UPDATE push_subscriptions SET lastOkAt = {:at} WHERE id = {:id}").Bind(dbx.Params{"at": now(), "id": sub.Id}).Execute()
	return err
}

// pushSubject is the contact push services may write to about this server: its application
// URL when it is https, else the project page.
func pushSubject(app core.App) string {
	if link := app.Settings().Meta.AppURL; strings.HasPrefix(link, "https://") {
		return link
	}
	return "https://github.com/oldbear24/odyle-dashboard"
}

// pushToAccount sends a message, written in each subscription's language, to every
// subscription of an account that wants push; a subscription its push service forgot is
// removed. It returns how many arrived.
func pushToAccount(app core.App, user string, n notificationSettings, write func(language string) pushMessage, ttl time.Duration, urgent bool) (int, error) {
	if !n.Channels.Push {
		return 0, nil
	}
	subs, err := app.FindAllRecords("push_subscriptions", dbx.HashExp{"user": user})
	if err != nil {
		return 0, err
	}
	sent, failed := 0, error(nil)
	for _, sub := range subs {
		switch err := sendPush(app, sub, write(sub.GetString("language")), ttl, urgent); {
		case errors.Is(err, errPushGone):
			if err := app.Delete(sub); err != nil {
				failed = err
			}
		case err != nil:
			failed = err
		default:
			sent++
		}
	}
	return sent, failed
}

func init() {
	pushCapAlert = func(app core.App, user *core.Record, n notificationSettings, alert capAlert) {
		if _, err := pushToAccount(app, user.Id, n, func(language string) pushMessage { return capAlertPush(language, alert, time.Now()) }, 3*time.Hour, false); err != nil {
			warn(app, "Odyle cap alert push failed", "user", user.Id, "error", message(err))
		}
	}
}
