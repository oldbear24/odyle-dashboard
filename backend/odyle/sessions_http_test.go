package odyle

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
)

// The sign-in side of an account over HTTP, as the Windows app and the browser use it: pairing
// with a one-use code, signing in with the device key, unpairing, forgetting a PC, signing out
// everywhere and deleting the account. (tests/integration.test.mjs drives the same routes on
// the built backend; these run with go test.)

// pairing is what an app gets for a pairing code.
type pairing struct {
	auth map[string]string
	key  string
	id   string
}

func pairWith(t *testing.T, app *tests.TestApp, browser map[string]string, name string) pairing {
	t.Helper()
	code := ask(t, app, "POST", "/api/odyle/desktop-code", browser, `{}`, 200)["code"].(string)
	got := ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+code+`","name":"`+name+`"}`, 200)
	token := got["token"].(string)
	claims, err := security.ParseUnverifiedJWT(token)
	if err != nil {
		t.Fatal(err)
	}
	return pairing{auth: map[string]string{"Authorization": token}, key: got["deviceKey"].(string), id: claims[deviceClaim].(string)}
}

func TestAPairingCodeWorksOnceAndOnlyWhileItLasts(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Pairing")
	browser := tokenOf(t, player)
	code := func() string {
		return ask(t, app, "POST", "/api/odyle/desktop-code", browser, `{}`, 200)["code"].(string)
	}
	// Typed as players type it: lower case, with spaces and dashes in the middle.
	first := code()
	typed := strings.ToLower(first[:4] + " " + first[4:8] + "-" + first[8:])
	got := ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+typed+`","name":"  My   PC  "}`, 200)
	if got["token"] == "" || got["deviceKey"] == "" || got["record"] == nil {
		t.Fatalf("pairing gave %v", got)
	}
	devices, err := devicesOf(app, player.Id, 0)
	if err != nil || len(devices) != 1 || devices[0].Name() != "My PC" {
		t.Fatalf("devices %v (%v)", devices, err)
	}
	// The code is gone with its use.
	if again := ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+first+`"}`, 400); again["message"] != "Pairing code is invalid or expired." {
		t.Fatalf("the code worked twice: %v", again)
	}
	// A new code replaces the one before it.
	older, newer := code(), code()
	ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+older+`"}`, 400)
	ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+newer+`"}`, 200)
	// An expired code is refused and kept for the expiry job.
	expired := code()
	if _, err := app.DB().NewQuery("UPDATE desktop_codes SET expiresAt = {:at}").Bind(dbx.Params{"at": stamp(time.Now().Add(-time.Second))}).Execute(); err != nil {
		t.Fatal(err)
	}
	ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+expired+`"}`, 400)
	// Not a code at all.
	for _, body := range []string{`{}`, `{"code":"` + strings.Repeat("A", 25) + `"}`} {
		ask(t, app, "POST", "/api/odyle/pair", nil, body, 400)
	}
	// Paused under Server controls: codes are not made and one made before is not taken.
	paused := code()
	if _, err := writeSettings(app, body{"pairingPaused": true}); err != nil {
		t.Fatal(err)
	}
	ask(t, app, "POST", "/api/odyle/desktop-code", browser, `{}`, 400)
	ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+paused+`"}`, 400)
	if _, err := writeSettings(app, body{"pairingPaused": false}); err != nil {
		t.Fatal(err)
	}
	ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+paused+`"}`, 200)
}

// Public actions need no account: they answer the same with no token, a token that signs
// nobody in and a token of a paired app, and sign-in works for a PC whose token expired.
func TestPublicActionsIgnoreATokenThatSignsNobodyIn(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Stale")
	browser := tokenOf(t, player)
	desk := pairWith(t, app, browser, "DESK")
	stale := map[string]string{"Authorization": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.not-a-signature"}
	for name, auth := range map[string]map[string]string{"garbage": stale, "bearer": {"Authorization": "Bearer nonsense"}, "none": nil, "own": desk.auth} {
		got := ask(t, app, "POST", "/api/odyle/desktop-sign-in", auth, `{"deviceKey":"`+desk.key+`"}`, 200)
		if got["token"] == "" || got["token"] == nil {
			t.Fatalf("%s: sign-in gave %v", name, got)
		}
		ask(t, app, "POST", "/api/odyle/desktop-sign-in", auth, `{"deviceKey":"unknown"}`, 401)
		ask(t, app, "POST", "/api/odyle/unpair", auth, `{"deviceKey":"unknown"}`, 200)
		ask(t, app, "POST", "/api/odyle/pair", auth, `{"code":"nothing"}`, 400)
		ask(t, app, "POST", "/api/odyle/invite-preview", auth, `{"code":"nothing"}`, 200)
	}
	// The signed-in actions still refuse it.
	ask(t, app, "GET", "/api/odyle/rooms", stale, "", 401)
	ask(t, app, "POST", "/api/odyle/desktop-code", stale, `{}`, 401)
	ask(t, app, "POST", "/api/odyle/sign-out-everywhere", nil, `{}`, 401)
}

func TestUnpairingForgetsOnlyThatKey(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Unpairer")
	browser := tokenOf(t, player)
	one, two := pairWith(t, app, browser, "ONE"), pairWith(t, app, browser, "TWO")
	session := ask(t, app, "POST", "/api/odyle/session", one.auth, `{"deviceKey":"`+one.key+`"}`, 200)["sessionId"].(string)
	if _, err := app.FindRecordById("publisher_sessions", session); err != nil {
		t.Fatal(err)
	}
	// The app asks with its key, not with a token: unpairing works for an app whose token ended.
	ask(t, app, "POST", "/api/odyle/unpair", nil, `{"deviceKey":"`+one.key+`"}`, 200)
	if _, err := app.FindRecordById("publisher_sessions", session); err == nil {
		t.Fatal("the PC's reader session stays open")
	}
	ask(t, app, "GET", "/api/odyle/rooms", one.auth, "", 401)
	ask(t, app, "POST", "/api/odyle/desktop-sign-in", nil, `{"deviceKey":"`+one.key+`"}`, 401)
	// Unpairing twice, and an unknown key, change nothing; a missing key is refused.
	ask(t, app, "POST", "/api/odyle/unpair", nil, `{"deviceKey":"`+one.key+`"}`, 200)
	ask(t, app, "POST", "/api/odyle/unpair", nil, `{}`, 400)
	ask(t, app, "POST", "/api/odyle/unpair", nil, `{"deviceKey":"`+strings.Repeat("k", 101)+`"}`, 400)
	// The other PC and the browser are untouched.
	ask(t, app, "GET", "/api/odyle/rooms", two.auth, "", 200)
	ask(t, app, "GET", "/api/odyle/rooms", browser, "", 200)
	ask(t, app, "POST", "/api/odyle/desktop-sign-in", nil, `{"deviceKey":"`+two.key+`"}`, 200)
}

func TestForgettingADeviceIsForItsOwnerOnly(t *testing.T) {
	app := newTestApp(t)
	owner, other := newUser(t, app, "Owner"), newUser(t, app, "Other")
	ownerAuth, otherAuth := tokenOf(t, owner), tokenOf(t, other)
	desk := pairWith(t, app, ownerAuth, "DESK")
	session := ask(t, app, "POST", "/api/odyle/session", desk.auth, `{"deviceKey":"`+desk.key+`"}`, 200)["sessionId"].(string)
	body := `{"deviceId":"` + desk.id + `"}`
	if got := ask(t, app, "POST", "/api/odyle/forget-device", otherAuth, body, 403); got["message"] != "This PC is paired with another account." {
		t.Fatalf("another account forgot it: %v", got)
	}
	ask(t, app, "GET", "/api/odyle/rooms", desk.auth, "", 200)
	ask(t, app, "POST", "/api/odyle/forget-device", nil, body, 401)
	ask(t, app, "POST", "/api/odyle/forget-device", ownerAuth, `{}`, 404)
	ask(t, app, "POST", "/api/odyle/forget-device", ownerAuth, body, 200)
	if _, err := app.FindRecordById("publisher_sessions", session); err == nil {
		t.Fatal("the forgotten PC's reader session stays open")
	}
	if got := ask(t, app, "POST", "/api/odyle/forget-device", ownerAuth, body, 404); got["message"] != "This PC is no longer paired." {
		t.Fatalf("forgetting twice: %v", got)
	}
	ask(t, app, "GET", "/api/odyle/rooms", desk.auth, "", 401)
}

func TestSigningOutEverywhereEndsEverySignIn(t *testing.T) {
	app := newTestApp(t)
	leaver, bystander := newUser(t, app, "Leaver"), newUser(t, app, "Bystander")
	browser, otherBrowser, bystanderAuth := tokenOf(t, leaver), tokenOf(t, leaver), tokenOf(t, bystander)
	desk, laptop, bystanderDesk := pairWith(t, app, browser, "DESK"), pairWith(t, app, browser, "LAPTOP"), pairWith(t, app, bystanderAuth, "THEIRS")
	for _, p := range []pairing{desk, laptop} {
		ask(t, app, "POST", "/api/odyle/session", p.auth, `{"deviceKey":"`+p.key+`"}`, 200)
	}
	spare := ask(t, app, "POST", "/api/odyle/desktop-code", browser, `{}`, 200)["code"].(string)
	ask(t, app, "POST", "/api/odyle/session", bystanderDesk.auth, `{"deviceKey":"`+bystanderDesk.key+`"}`, 200)

	got := ask(t, app, "POST", "/api/odyle/sign-out-everywhere", browser, `{}`, 200)
	fresh := map[string]string{"Authorization": got["token"].(string)}
	// Every earlier token and key is dead: other browsers, both PCs, a code not used yet.
	for name, auth := range map[string]map[string]string{"asking browser": browser, "other browser": otherBrowser, "desk": desk.auth, "laptop": laptop.auth} {
		if got := ask(t, app, "GET", "/api/odyle/rooms", auth, "", 401); got == nil {
			t.Fatalf("%s: no answer", name)
		}
	}
	for _, key := range []string{desk.key, laptop.key} {
		ask(t, app, "POST", "/api/odyle/desktop-sign-in", nil, `{"deviceKey":"`+key+`"}`, 401)
	}
	ask(t, app, "POST", "/api/odyle/pair", nil, `{"code":"`+spare+`"}`, 400)
	// The asking browser has a new token and no leftovers; the other account is untouched.
	ask(t, app, "GET", "/api/odyle/rooms", fresh, "", 200)
	for _, c := range []struct {
		collection string
		want       int64
	}{{"desktop_devices", 1}, {"desktop_codes", 0}, {"publisher_sessions", 1}} {
		if n := countOf(t, app, c.collection); n != c.want {
			t.Errorf("%s: %d left, want %d (only the bystander's)", c.collection, n, c.want)
		}
	}
	ask(t, app, "GET", "/api/odyle/rooms", bystanderAuth, "", 200)
	ask(t, app, "GET", "/api/odyle/rooms", bystanderDesk.auth, "", 200)
	// A PC pairs again with a new code.
	again := pairWith(t, app, fresh, "DESK")
	ask(t, app, "GET", "/api/odyle/rooms", again.auth, "", 200)
}

func TestDeletingTheAccountNeedsConfirmationAndTakesItsDataAlong(t *testing.T) {
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	leaver, mate := newUser(t, app, "Leaving"), newUser(t, app, "Staying")
	browser, mateAuth := tokenOf(t, leaver), tokenOf(t, mate)
	room := saved(t, app, "party_rooms", map[string]any{"owner": leaver.Id, "name": "Handed over", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": leaver.Id, "role": "owner"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	alone := saved(t, app, "party_rooms", map[string]any{"owner": leaver.Id, "name": "Alone", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": alone.Id, "user": leaver.Id, "role": "owner"})
	character := saved(t, app, "characters", map[string]any{"user": leaver.Id, "characterName": "Gone", "server": "Lumiel", "region": "GLOBAL_EU"})
	saved(t, app, "character_readings", map[string]any{"character": character.Id, "value": 5})
	saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Kept", "server": "Lumiel", "region": "GLOBAL_EU"})
	desk := pairWith(t, app, browser, "DESK")
	ask(t, app, "POST", "/api/odyle/session", desk.auth, `{"deviceKey":"`+desk.key+`"}`, 200)

	// Without the confirmation nothing happens.
	for _, body := range []string{`{}`, `{"confirm":false}`, `{"confirm":"yes"}`} {
		if got := ask(t, app, "POST", "/api/odyle/delete-account", browser, body, 400); got["message"] != "Confirm that the account should be deleted." {
			t.Fatalf("%s: %v", body, got)
		}
	}
	ask(t, app, "GET", "/api/odyle/rooms", browser, "", 200)
	ask(t, app, "POST", "/api/odyle/delete-account", nil, `{"confirm":true}`, 401)
	ask(t, app, "POST", "/api/odyle/delete-account", browser, `{"confirm":true}`, 200)

	if _, err := app.FindRecordById("users", leaver.Id); err == nil {
		t.Fatal("the account stays")
	}
	for _, collection := range []string{"character_readings", "desktop_devices", "publisher_sessions"} {
		if n := countOf(t, app, collection); n != 0 {
			t.Errorf("%s: %d left", collection, n)
		}
	}
	if n := countOf(t, app, "characters"); n != 1 {
		t.Errorf("%d characters left, want the other account's one", n)
	}
	// The room with another member passes to them; the one with nobody else closes.
	handed, err := app.FindRecordById("party_rooms", room.Id)
	if err != nil || handed.GetString("owner") != mate.Id {
		t.Fatalf("handed-over room: %v (%v)", handed, err)
	}
	if _, err := app.FindRecordById("party_rooms", alone.Id); err == nil {
		t.Fatal("a room nobody else is in stays open")
	}
	// Nothing of the account signs in any more.
	ask(t, app, "GET", "/api/odyle/rooms", browser, "", 401)
	ask(t, app, "GET", "/api/odyle/rooms", desk.auth, "", 401)
	ask(t, app, "POST", "/api/odyle/desktop-sign-in", nil, `{"deviceKey":"`+desk.key+`"}`, 401)
	ask(t, app, "GET", "/api/odyle/rooms", mateAuth, "", 200)
}

// Six apps pairing with one code at once: exactly one gets in. The code is deleted in the
// transaction that reads it, so the rest find none.
func TestAPairingCodeIsUsedOnceWhenSixPairAtOnce(t *testing.T) {
	app := newTestApp(t)
	player := newUser(t, app, "Racer")
	code := ask(t, app, "POST", "/api/odyle/desktop-code", tokenOf(t, player), `{}`, 200)["code"].(string)
	mux := muxOf(t, app)
	statuses := atOnce(6, func(int) int {
		return postStatus(mux, "/api/odyle/pair", nil, `{"code":"`+code+`","name":"RACE"}`)
	})
	if got := count200(statuses); got != 1 {
		t.Fatalf("%d of 6 pairings succeeded: %v", got, statuses)
	}
	if n := countOf(t, app, "desktop_devices"); n != 1 {
		t.Fatalf("%d devices", n)
	}
}

// Five accounts joining on a link good for one use: exactly one gets in.
func TestAOneUseInviteLinkLetsExactlyOneJoinWhenFiveJoinAtOnce(t *testing.T) {
	app := newTestApp(t)
	lead := newUser(t, app, "Lead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	made := ask(t, app, "POST", "/api/odyle/invite-create", tokenOf(t, lead), `{"roomId":"`+room.Id+`","maxUses":1}`, 200)
	code := made["invite"].(map[string]any)["code"].(string)
	players := make([]map[string]string, 5)
	for i := range players {
		players[i] = tokenOf(t, newUser(t, app, "Joiner"+string(rune('A'+i))))
	}
	mux := muxOf(t, app)
	statuses := atOnce(5, func(i int) int {
		return postStatus(mux, "/api/odyle/join", players[i], `{"code":"`+code+`"}`)
	})
	if got := count200(statuses); got != 1 {
		t.Fatalf("%d of 5 joined: %v", got, statuses)
	}
	if n := countOf(t, app, "room_members"); n != 2 {
		t.Fatalf("%d members", n)
	}
	invites, err := app.FindAllRecords("room_invites")
	if err != nil || len(invites) != 1 || invites[0].GetInt("uses") != 1 {
		t.Fatalf("invites %v (%v)", invites, err)
	}
}

func count200(statuses []int) int {
	n := 0
	for _, s := range statuses {
		if s == 200 {
			n++
		}
	}
	return n
}

// muxOf is the test app's router, built once, for requests that run side by side.
func muxOf(t testing.TB, app *tests.TestApp) http.Handler {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	var mux http.Handler
	err = app.OnServe().Trigger(&core.ServeEvent{App: app, Router: router}, func(e *core.ServeEvent) error {
		var err error
		mux, err = e.Router.BuildMux()
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return mux
}

// postStatus sends a JSON body to a route of the router and returns the status.
func postStatus(mux http.Handler, path string, auth map[string]string, body string) int {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("content-type", "application/json")
	for k, v := range auth {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec.Code
}

// atOnce runs the function n times at once, released together, and returns what each gave.
func atOnce(n int, fn func(i int) int) []int {
	out := make([]int, n)
	var ready, done sync.WaitGroup
	gate := make(chan struct{})
	for i := range n {
		ready.Add(1)
		done.Add(1)
		go func() {
			defer done.Done()
			ready.Done()
			<-gate
			out[i] = fn(i)
		}()
	}
	ready.Wait()
	close(gate)
	done.Wait()
	return out
}
