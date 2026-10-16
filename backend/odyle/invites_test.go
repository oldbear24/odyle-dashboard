package odyle

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/security"
)

// ask sends one request to the test app and decodes its JSON answer.
func ask(t *testing.T, app *tests.TestApp, method, url string, auth map[string]string, body string, status int) map[string]any {
	t.Helper()
	var out map[string]any
	s := tests.ApiScenario{Name: method + " " + url, Method: method, URL: url, Headers: auth, ExpectedStatus: status, ExpectedContent: []string{"{"},
		TestAppFactory: func(testing.TB) *tests.TestApp { return app }, DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
				t.Fatal(err)
			}
		}}
	if body != "" {
		s.Body = strings.NewReader(body)
	}
	s.Test(t)
	return out
}

func tokenOf(t *testing.T, user *core.Record) map[string]string {
	t.Helper()
	raw, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return map[string]string{"Authorization": raw}
}

// Owners make links one by one; the server lists them without their codes, previews
// tell whoever holds a code which room it opens, joins count against the use limit and
// a revoked link stops working.
func TestInviteLinksArePreviewedCountedListedAndRevoked(t *testing.T) {
	app := newTestApp(t)
	lead, mate, late, outsider := newUser(t, app, "Lumina"), newUser(t, app, "Mate"), newUser(t, app, "Late"), newUser(t, app, "Outsider")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "The evening expedition", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	owner := tokenOf(t, lead)
	preview := func(code string) map[string]any {
		return ask(t, app, http.MethodPost, "/api/odyle/invite-preview", nil, `{"code":"`+code+`"}`, 200)
	}

	// A one-use player link for a week, with a label.
	made := ask(t, app, http.MethodPost, "/api/odyle/invite-create", owner, `{"roomId":"`+room.Id+`","role":"reporter","expiresIn":604800,"maxUses":1,"label":"  Discord #raids "}`, 200)
	link := made["invite"].(map[string]any)
	code := link["code"].(string)
	if link["role"] != "reporter" || link["label"] != "Discord #raids" || link["maxUses"] != float64(1) || link["uses"] != float64(0) {
		t.Fatalf("made %v", link)
	}
	if expires := timeOf(link["expiresAt"].(string)); time.Until(expires) < 6*24*time.Hour {
		t.Fatalf("a week-long link expires %v", expires)
	}
	// A viewer link with the defaults: a day, any number of joins.
	viewer := ask(t, app, http.MethodPost, "/api/odyle/invite-create", owner, `{"roomId":"`+room.Id+`","role":"viewer"}`, 200)["invite"].(map[string]any)
	if expires := timeOf(viewer["expiresAt"].(string)); time.Until(expires) < 23*time.Hour || time.Until(expires) > 25*time.Hour || viewer["maxUses"] != float64(0) {
		t.Fatalf("default link %v", viewer)
	}

	// The owner's list: player links first, never a code or digest; members cannot list.
	listed := ask(t, app, http.MethodGet, "/api/odyle/invites/"+room.Id, owner, "", 200)["invites"].([]any)
	if len(listed) != 2 || listed[0].(map[string]any)["id"] != link["id"] || listed[1].(map[string]any)["id"] != viewer["id"] {
		t.Fatalf("listed %v", listed)
	}
	for _, l := range listed {
		raw, _ := json.Marshal(l)
		if strings.Contains(string(raw), code) || strings.Contains(string(raw), "digest") || strings.Contains(string(raw), `"code"`) {
			t.Fatalf("the list shows a code: %s", raw)
		}
	}
	ask(t, app, http.MethodGet, "/api/odyle/invites/"+room.Id, tokenOf(t, outsider), "", 403)

	// Anyone with the code learns the room, the inviter, the role and the members, typed with spaces too.
	shown := preview(strings.ToLower(code[:4] + " " + code[4:8] + "-" + code[8:]))
	if shown["state"] != "valid" || shown["room"] != "The evening expedition" || shown["inviter"] != "Lumina" || shown["role"] != "reporter" || shown["members"] != float64(1) {
		t.Fatalf("preview %v", shown)
	}
	if unknown := preview("ZZZZZZZZZZZZ"); len(unknown) != 1 || unknown["state"] != "unknown" {
		t.Fatalf("unknown code %v", unknown)
	}
	if unknown := ask(t, app, http.MethodPost, "/api/odyle/invite-preview", nil, `{"code":5}`, 200); unknown["state"] != "unknown" {
		t.Fatalf("no code %v", unknown)
	}

	// The one join it allows; a member opening it again uses nothing, then it is used up.
	joined := ask(t, app, http.MethodPost, "/api/odyle/join", tokenOf(t, mate), `{"code":"`+code+`"}`, 200)
	if joined["membership"].(map[string]any)["role"] != "reporter" || joined["alreadyMember"] != nil {
		t.Fatalf("joined %v", joined)
	}
	if again := ask(t, app, http.MethodPost, "/api/odyle/join", tokenOf(t, mate), `{"code":"`+code+`"}`, 200); again["alreadyMember"] != true {
		t.Fatalf("again %v", again)
	}
	ask(t, app, http.MethodPost, "/api/odyle/join", tokenOf(t, late), `{"code":"`+code+`"}`, 400)
	// Used up, the link names only its room and leaves the owner's list.
	if used := preview(code); len(used) != 2 || used["state"] != "expired" || used["room"] != "The evening expedition" {
		t.Fatalf("used-up preview %v", used)
	}
	if listed := ask(t, app, http.MethodGet, "/api/odyle/invites/"+room.Id, owner, "", 200)["invites"].([]any); len(listed) != 1 || listed[0].(map[string]any)["id"] != viewer["id"] {
		t.Fatalf("after use %v", listed)
	}

	// A revoked link stops working at once; members who joined with it stay.
	revoked := ask(t, app, http.MethodPost, "/api/odyle/invite-revoke", owner, `{"roomId":"`+room.Id+`","inviteId":"`+viewer["id"].(string)+`"}`, 200)
	if len(revoked["invites"].([]any)) != 0 {
		t.Fatalf("after revoke %v", revoked)
	}
	ask(t, app, http.MethodPost, "/api/odyle/join", tokenOf(t, late), `{"code":"`+viewer["code"].(string)+`"}`, 400)
	if gone := preview(viewer["code"].(string)); gone["state"] != "unknown" {
		t.Fatalf("revoked preview %v", gone)
	}
	if n := countOf(t, app, "room_members"); n != 2 {
		t.Fatalf("%d members", n)
	}
	// Only the owner makes and revokes links; another room's link is left alone.
	ask(t, app, http.MethodPost, "/api/odyle/invite-create", tokenOf(t, mate), `{"roomId":"`+room.Id+`"}`, 403)
	other := saved(t, app, "party_rooms", map[string]any{"owner": outsider.Id, "name": "Elsewhere", "cost": 40})
	foreign := saved(t, app, "room_invites", map[string]any{"room": other.Id, "role": "reporter", "digest": "foreign", "expiresAt": expiry(3600)})
	ask(t, app, http.MethodPost, "/api/odyle/invite-revoke", owner, `{"roomId":"`+room.Id+`","inviteId":"`+foreign.Id+`"}`, 200)
	if _, err := app.FindRecordById("room_invites", foreign.Id); err != nil {
		t.Fatal("another room's link was revoked")
	}

	// The account's data export lists the links it made, without codes.
	exported := ask(t, app, http.MethodGet, "/api/odyle/export", owner, "", 200)["inviteLinks"].([]any)
	if len(exported) != 1 || exported[0].(map[string]any)["name"] != "The evening expedition" || exported[0].(map[string]any)["uses"] != float64(1) {
		t.Fatalf("exported %v", exported)
	}
}

func TestInviteLinkChoicesAreChecked(t *testing.T) {
	app := newTestApp(t)
	lead := newUser(t, app, "Lead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Raid", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	owner := tokenOf(t, lead)
	for body, message := range map[string]string{
		`"role":"owner"`:      "Choose player or viewer.",
		`"expiresIn":3600`:    "An invite link lasts 30 minutes, 24 hours or 7 days.",
		`"expiresIn":"86400"`: "An invite link lasts 30 minutes, 24 hours or 7 days.",
		`"maxUses":51`:        "A use limit is a whole number up to 50, or 0 for none.",
		`"maxUses":1.5`:       "A use limit is a whole number up to 50, or 0 for none.",
		`"label":"` + strings.Repeat("x", 41) + `"`: "A link label has up to 40 characters.",
	} {
		refused := ask(t, app, http.MethodPost, "/api/odyle/invite-create", owner, `{"roomId":"`+room.Id+`",`+body+`}`, 400)
		if refused["message"] != message {
			t.Errorf("%s: %v", body, refused["message"])
		}
	}
	// Up to 20 open links; expired ones do not count.
	saved(t, app, "room_invites", map[string]any{"room": room.Id, "role": "reporter", "digest": "old", "expiresAt": expiry(-60)})
	for range openInviteLimit {
		ask(t, app, http.MethodPost, "/api/odyle/invite-create", owner, `{"roomId":"`+room.Id+`","expiresIn":1800}`, 200)
	}
	if refused := ask(t, app, http.MethodPost, "/api/odyle/invite-create", owner, `{"roomId":"`+room.Id+`"}`, 400); refused["message"] != "A room can have up to 20 open invite links. Revoke one first." {
		t.Fatalf("21st link: %v", refused)
	}
}

// Links from before makers were kept still join and name the room owner as the inviter,
// and so do links whose maker no longer owns the room or deleted the account.
func TestOlderInviteLinksNameTheOwner(t *testing.T) {
	app := newTestApp(t)
	lead := newUser(t, app, "OldLead")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Old room", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	code := "OLDLNK234567"
	saved(t, app, "room_invites", map[string]any{"room": room.Id, "role": "viewer", "digest": security.SHA256(code), "expiresAt": expiry(600)})
	shown := ask(t, app, http.MethodPost, "/api/odyle/invite-preview", nil, `{"code":"`+code+`"}`, 200)
	if shown["state"] != "valid" || shown["inviter"] != "OldLead" || shown["role"] != "viewer" {
		t.Fatalf("preview %v", shown)
	}
	if joined := ask(t, app, http.MethodPost, "/api/odyle/join", tokenOf(t, newUser(t, app, "Guest")), `{"code":"`+code+`"}`, 200); joined["membership"].(map[string]any)["role"] != "viewer" {
		t.Fatalf("joined %v", joined)
	}
	// A link made by the owner names them while they own the room.
	maker := newUser(t, app, "Maker")
	made := "MADEBY234567"
	saved(t, app, "room_invites", map[string]any{"room": room.Id, "role": "reporter", "digest": security.SHA256(made), "expiresAt": expiry(600), "createdBy": maker.Id})
	room.Set("owner", maker.Id)
	if err := app.Save(room); err != nil {
		t.Fatal(err)
	}
	if shown := ask(t, app, http.MethodPost, "/api/odyle/invite-preview", nil, `{"code":"`+made+`"}`, 200); shown["inviter"] != "Maker" {
		t.Fatalf("preview %v", shown)
	}
	// Handed over, the link keeps working and names the new owner, not its maker.
	room.Set("owner", lead.Id)
	if err := app.Save(room); err != nil {
		t.Fatal(err)
	}
	if shown := ask(t, app, http.MethodPost, "/api/odyle/invite-preview", nil, `{"code":"`+made+`"}`, 200); shown["state"] != "valid" || shown["inviter"] != "OldLead" {
		t.Fatalf("preview after the hand-over %v", shown)
	}
	// A link whose maker deleted the account names the owner too, and keeps working.
	if err := app.Delete(maker); err != nil {
		t.Fatal(err)
	}
	if shown := ask(t, app, http.MethodPost, "/api/odyle/invite-preview", nil, `{"code":"`+made+`"}`, 200); shown["state"] != "valid" || shown["inviter"] != "OldLead" {
		t.Fatalf("preview after the maker left %v", shown)
	}
}

// Previews are public, so each address may ask about 30 codes a minute.
func TestInvitePreviewsHaveTheirOwnRateLimit(t *testing.T) {
	app := newTestApp(t)
	for _, r := range app.Settings().RateLimits.Rules {
		if r.Label == "/api/odyle/invite-preview" {
			if r.MaxRequests != 30 || r.Duration != 60 || r.Audience != "" {
				t.Fatalf("rule %+v", r)
			}
			return
		}
	}
	t.Fatal("no rate limit for invite previews")
}
