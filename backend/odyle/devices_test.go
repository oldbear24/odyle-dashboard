package odyle

import (
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
)

// A paired app's token names its PC and works only while the PC is paired: forgetting the PC
// under Account & data cuts it off at once, and it can still pair again with a new code. The browser that forgot it stays signed in.
func TestForgettingAPCCutsItsTokenOff(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Pairer")
	browser := tokenOf(t, player)
	pairOnce := func(auth map[string]string) (map[string]string, string) {
		t.Helper()
		code := ask(t, app, "POST", "/api/odyle/desktop-code", browser, `{}`, 200)["code"].(string)
		got := ask(t, app, "POST", "/api/odyle/pair", auth, `{"code":"`+code+`","name":"DESK"}`, 200)
		return map[string]string{"Authorization": got["token"].(string)}, got["deviceKey"].(string)
	}
	desk, key := pairOnce(nil)
	claims, err := security.ParseUnverifiedJWT(desk["Authorization"])
	if err != nil || claims["refreshable"] != false || claims[deviceClaim] == "" {
		t.Fatalf("app token claims %v (%v)", claims, err)
	}
	if exp, _ := claims["exp"].(float64); time.Until(time.Unix(int64(exp), 0)) > appTokenLifetime+time.Minute {
		t.Fatalf("the app token lasts until %v", time.Unix(int64(exp), 0))
	}
	ask(t, app, "GET", "/api/odyle/rooms", desk, "", 200)
	// Signing in with the device key gives a token bound to the same PC.
	signedIn := ask(t, app, "POST", "/api/odyle/desktop-sign-in", desk, `{"deviceKey":"`+key+`"}`, 200)
	again, _ := security.ParseUnverifiedJWT(signedIn["token"].(string))
	if again[deviceClaim] != claims[deviceClaim] {
		t.Fatalf("sign-in token names %v, pairing %v", again[deviceClaim], claims[deviceClaim])
	}
	// The account forgets the PC.
	ask(t, app, "POST", "/api/odyle/forget-device", browser, `{"deviceId":"`+claims[deviceClaim].(string)+`"}`, 200)
	ask(t, app, "GET", "/api/odyle/rooms", desk, "", 401)
	ask(t, app, "GET", "/api/odyle/export", desk, "", 401)
	ask(t, app, "GET", "/api/odyle/rooms", map[string]string{"Authorization": signedIn["token"].(string)}, "", 401)
	if got := ask(t, app, "POST", "/api/odyle/desktop-sign-in", desk, `{"deviceKey":"`+key+`"}`, 401); got["message"] != "This PC is no longer paired with an account." {
		t.Fatalf("sign-in after forgetting: %v", got)
	}
	ask(t, app, "GET", "/api/odyle/rooms", browser, "", 200)
	// The forgotten PC pairs again with a new code, sending its old token as apps do.
	desk, _ = pairOnce(desk)
	ask(t, app, "GET", "/api/odyle/rooms", desk, "", 200)
	// Nobody mints a device key with a token any more (1.0.0): the route that gave apps paired
	// before device keys theirs is gone, for a browser and a paired app alike.
	ask(t, app, "POST", "/api/odyle/desktop-device", browser, `{}`, 404)
	ask(t, app, "POST", "/api/odyle/desktop-device", desk, `{}`, 404)
}

// The expiry job ends pairings no app signed in with for half a year.
func TestUnusedPairingsEnd(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Traveller")
	old := saved(t, app, "desktop_devices", map[string]any{"user": player.Id, "digest": "old", "lastUsedAt": stamp(time.Now().Add(-deviceKeep - time.Hour))})
	recent := saved(t, app, "desktop_devices", map[string]any{"user": player.Id, "digest": "recent", "lastUsedAt": stamp(time.Now().Add(-time.Hour))})
	never := saved(t, app, "desktop_devices", map[string]any{"user": player.Id, "digest": "never"})
	if _, err := cleanup(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindRecordById("desktop_devices", old.Id); err == nil {
		t.Fatal("a pairing unused for half a year stays")
	}
	for _, kept := range []string{recent.Id, never.Id} {
		if _, err := app.FindRecordById("desktop_devices", kept); err != nil {
			t.Fatalf("pairing %s ended: %v", kept, err)
		}
	}
}

// The reader routes take only a paired PC (1.0.0): a session needs the PC's device key, and
// readings and character saves come only with the token of the PC that opened the session. An
// app paired before device keys (its token a browser's) is told with a 401 to pair again.
func TestReaderRoutesTakeOnlyAPairedPC(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Reader")
	browser := tokenOf(t, player)
	desk, other := pairWith(t, app, browser, "DESK"), pairWith(t, app, browser, "LAPTOP")
	for _, auth := range []map[string]string{browser, desk.auth} {
		if got := ask(t, app, "POST", "/api/odyle/session", auth, `{}`, 401); got["message"] != pairAgain {
			t.Fatalf("a session without a device key: %v", got)
		}
	}
	ask(t, app, "POST", "/api/odyle/session", desk.auth, `{"deviceKey":"unknown"}`, 401)
	session := ask(t, app, "POST", "/api/odyle/session", desk.auth, `{"deviceKey":"`+desk.key+`"}`, 200)["sessionId"].(string)
	reading := func(sequence int) string {
		return `{"sessionId":"` + session + `","sequence":` + strings.Repeat("1", sequence) + `,"value":15,"characterName":"Hero","server":"Lumiel","region":"GLOBAL_EU","source":"packet","parserVersion":"` + acceptedAdapters(app)[0] + `","confirmed":true}`
	}
	// Another token, the browser's or another PC's of the same account, sends nothing in its name.
	for _, auth := range []map[string]string{browser, other.auth} {
		if got := ask(t, app, "POST", "/api/odyle/report", auth, reading(1), 401); got["message"] != pairAgain {
			t.Fatalf("a reading with another token: %v", got)
		}
	}
	ask(t, app, "POST", "/api/odyle/report", desk.auth, reading(1), 200)
	// A session from before 1.0.0 without a PC takes no reading, even from a paired app.
	keyless := saved(t, app, "publisher_sessions", map[string]any{"user": player.Id, "expiresAt": expiry(86400)})
	ask(t, app, "POST", "/api/odyle/report", desk.auth, strings.Replace(reading(2), session, keyless.Id, 1), 401)
	// Character saves likewise.
	character := `{"characterName":"Alt","server":"Lumiel","region":"GLOBAL_EU"}`
	if got := ask(t, app, "POST", "/api/odyle/character", browser, character, 401); got["message"] != pairAgain {
		t.Fatalf("a character saved by a browser: %v", got)
	}
	ask(t, app, "POST", "/api/odyle/character", desk.auth, character, 200)
}

// An account's readings have a budget per minute.
func TestReadingsHaveAPerAccountBudget(t *testing.T) {
	app := newTestApp(t)
	at := time.Now()
	for i := 0; i < readingsPerMinute; i++ {
		if ok, _ := allowReading(app, "account", at); !ok {
			t.Fatalf("reading %d refused", i+1)
		}
	}
	if ok, wait := allowReading(app, "account", at.Add(10*time.Second)); ok || wait <= 0 || wait > 50*time.Second {
		t.Fatalf("over the budget: %v, wait %v", ok, wait)
	}
	if ok, _ := allowReading(app, "other", at); !ok {
		t.Fatal("another account's reading was refused")
	}
	if ok, _ := allowReading(app, "account", at.Add(time.Minute)); !ok {
		t.Fatal("the next minute's reading was refused")
	}
}

// Only readings from an account's own open session name their adapter on Server status and
// in the operator's alerts, and only names an adapter can have; the alerts stop at a few.
func TestOnlyOwnReadingsNameAdapters(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Prankster")
	auth, key, _ := pairedPC(t, app, player)
	ask(t, app, "POST", "/api/odyle/report", auth, `{"sessionId":"nope","sequence":1,"value":1,"parserVersion":"https://example.invalid/click"}`, 403)
	ask(t, app, "POST", "/api/odyle/report", auth, `{"sessionId":"nope","sequence":1,"value":1,"parserVersion":"plausible-v9"}`, 403)
	session := ask(t, app, "POST", "/api/odyle/session", auth, `{"deviceKey":"`+key+`"}`, 200)["sessionId"].(string)
	ask(t, app, "POST", "/api/odyle/report", auth, `{"sessionId":"`+session+`","sequence":1,"value":1,"characterName":"Hero","server":"Lumiel","region":"GLOBAL_EU","parserVersion":"has spaces"}`, 400)
	if seen := seenAdapters(app); len(seen) != 0 {
		t.Fatalf("seen %v", seen)
	}
	for _, name := range []string{"new-a", "new-b", "new-c", "new-d", "new-e", "new-f", "new-g"} {
		ask(t, app, "POST", "/api/odyle/report", auth, `{"sessionId":"`+session+`","sequence":1,"value":1,"characterName":"Hero","server":"Lumiel","region":"GLOBAL_EU","parserVersion":"`+name+`"}`, 400)
	}
	if seen := seenAdapters(app); len(seen) != 7 {
		t.Fatalf("seen %d adapters", len(seen))
	}
	_, problems := readerHealth(app, time.Now())
	alerts := 0
	for key := range problems {
		if strings.HasPrefix(key, "adapter:") {
			alerts++
		}
	}
	if alerts != adapterAlerts {
		t.Fatalf("%d adapter alerts", alerts)
	}
}
