package odyle

import (
	"net/http"
	"testing"
)

// 1.0.0 removed what was kept for Windows apps and dashboards older than the minimum Windows
// app (0.37.0): those routes answer 404 like any route the server does not have, and the
// requests the current clients never send are refused.
func TestWhat1Point0RemovedIsGone(t *testing.T) {
	app := newTestApp(t)
	lead, mate := newUser(t, app, "Lead"), newUser(t, app, "Mate")
	room := saved(t, app, "party_rooms", map[string]any{"owner": lead.Id, "name": "Old room", "cost": 40})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": lead.Id, "role": "owner"})
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	first := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "First", "server": "Lumiel", "region": "GLOBAL_EU"})
	second := saved(t, app, "characters", map[string]any{"user": mate.Id, "characterName": "Second", "server": "Lumiel", "region": "GLOBAL_EU"})
	other := saved(t, app, "characters", map[string]any{"user": lead.Id, "characterName": "Other", "server": "Lumiel", "region": "GLOBAL_EU"})
	owner, auth := tokenOf(t, lead), tokenOf(t, mate)

	// Replacing every invite link of a room at once (dashboards before links were made one by one).
	ask(t, app, http.MethodPost, "/api/odyle/invites", owner, `{"roomId":"`+room.Id+`"}`, 404)

	// Sharing names its characters: without characterId or characterIds nothing is shared.
	in := `"roomId":"` + room.Id + `","enabled":true`
	ask(t, app, http.MethodPost, "/api/odyle/sharing", auth, `{`+in+`}`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/sharing", auth, `{`+in+`,"characterIds":[]}`, 400)
	ask(t, app, http.MethodPost, "/api/odyle/sharing", auth, `{`+in+`,"characterIds":"`+first.Id+`"}`, 400)
	// Another account's character refuses the whole list.
	ask(t, app, http.MethodPost, "/api/odyle/sharing", auth, `{`+in+`,"characterIds":["`+first.Id+`","`+other.Id+`"]}`, 403)
	if shared := ask(t, app, http.MethodPost, "/api/odyle/sharing", auth, `{`+in+`,"characterIds":["`+second.Id+`","`+first.Id+`","`+second.Id+`"]}`, 200)["sharedCharacters"]; asJSON(t, shared) != `["`+second.Id+`","`+first.Id+`"]` {
		t.Fatalf("shared %v", shared)
	}
	if shared := ask(t, app, http.MethodPost, "/api/odyle/sharing", auth, `{"roomId":"`+room.Id+`","enabled":false,"characterIds":["`+second.Id+`","`+first.Id+`"]}`, 200)["sharedCharacters"]; asJSON(t, shared) != `[]` {
		t.Fatalf("still shared %v", shared)
	}
}
