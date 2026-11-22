package odyle

import (
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
)

// Invite links last 30 minutes, a day (the default) or a week, and may be limited to a
// number of joins. A room has up to 20 open links. An expired link is kept three more
// days, so opening it still names its room (invitePreview) instead of saying nothing.
var inviteLifetimes = []int{1800, 86400, 604800}

const defaultInviteLifetime, openInviteLimit, inviteGrace = 86400, 20, 72 * time.Hour

type inviteOptions struct {
	role     string
	lifetime int
	maxUses  int64
	label    string
}

// invite makes a link to the room: its code goes to the owner's browser once, the server
// keeps the digest and the link's details (JSON).
func invite(app core.App, room *Room, userId string, o inviteOptions) (map[string]any, error) {
	code := security.RandomStringWithAlphabet(12, codeAlphabet)
	made, err := newAs[Invite](app, "room_invites")
	if err != nil {
		return nil, err
	}
	made.Set("room", room.Id)
	made.Set("role", o.role)
	made.Set("digest", security.SHA256(code))
	made.Set("expiresAt", expiry(o.lifetime))
	made.Set("createdBy", userId)
	made.Set("label", o.label)
	made.Set("maxUses", o.maxUses)
	if err := app.Save(made); err != nil {
		return nil, err
	}
	out := made.JSON()
	out["code"] = code
	return out, nil
}

// openInvites lists the room's links that still let someone join, player links first,
// then the newest.
func openInvites(app core.App, roomId string) ([]map[string]any, error) {
	found, err := whereAs[Invite](app, "room_invites", "room = {:room} && expiresAt > {:now}", dbx.Params{"room": roomId, "now": stamp(time.Now())})
	if err != nil {
		return nil, err
	}
	at, open := time.Now(), []*Invite{}
	for _, i := range found {
		if i.Open(at) {
			open = append(open, i)
		}
	}
	sort.SliceStable(open, func(a, b int) bool {
		if open[a].Role() != open[b].Role() {
			return open[a].Role() == "reporter"
		}
		if open[a].Created() != open[b].Created() {
			return open[a].Created() > open[b].Created()
		}
		return open[a].GetString("expiresAt") > open[b].GetString("expiresAt")
	})
	return pluck(open, (*Invite).JSON), nil
}

func addMember(app core.App, roomId, userId, role string) (*Member, error) {
	m, err := newAs[Member](app, "room_members")
	if err != nil {
		return nil, err
	}
	m.Set("room", roomId)
	m.Set("user", userId)
	m.SetRole(role)
	return m, app.Save(m)
}

func joinable(app core.App, userId string) error {
	count, err := app.CountRecords("room_members", dbx.HashExp{"user": userId})
	if err != nil {
		return err
	}
	if count >= limits.Memberships {
		return badRequest("You can be in up to 50 rooms. Leave one first.")
	}
	return nil
}

// roomInvites makes a player and a viewer link with the default lifetime, for a new room.
func roomInvites(app core.App, room *Room, userId string) ([]any, error) {
	reporter, err := invite(app, room, userId, inviteOptions{role: "reporter", lifetime: defaultInviteLifetime})
	if err != nil {
		return nil, err
	}
	viewer, err := invite(app, room, userId, inviteOptions{role: "viewer", lifetime: defaultInviteLifetime})
	if err != nil {
		return nil, err
	}
	return []any{reporter, viewer}, nil
}

var codeSeparators = regexp.MustCompile(`[\s\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}-]`)

// normalizeCode drops spaces and dashes of a typed code and upper-cases it.
func normalizeCode(code string) string {
	return strings.ToUpper(codeSeparators.ReplaceAllString(code, ""))
}

// inviteCreate makes one invite link for the owner: a role (player by default), a
// lifetime (a day by default), an optional use limit and label. The answer carries the
// code once, and the room's open links.
func inviteCreate(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		room, err := manager(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		o := inviteOptions{role: "reporter", lifetime: defaultInviteLifetime}
		if b.has("role") {
			if o.role, _ = b.text("role"); o.role != "reporter" && o.role != "viewer" {
				return nil, badRequest("Choose player or viewer.")
			}
		}
		if b.has("expiresIn") {
			seconds, err := integer(b["expiresIn"], "expiresIn", 0, maxSafeInteger)
			if o.lifetime = int(seconds); err != nil || !slices.Contains(inviteLifetimes, o.lifetime) {
				return nil, badRequest("An invite link lasts 30 minutes, 24 hours or 7 days.")
			}
		}
		if b.has("maxUses") {
			if o.maxUses, err = integer(b["maxUses"], "maxUses", 0, 50); err != nil {
				return nil, badRequest("A use limit is a whole number up to 50, or 0 for none.")
			}
		}
		if b.set("label") {
			label, ok := b.text("label")
			if o.label = trim(label); !ok || length(o.label) > 40 {
				return nil, badRequest("A link label has up to 40 characters.")
			}
		}
		open, err := openInvites(app, room.Id)
		if err != nil {
			return nil, err
		}
		if len(open) >= openInviteLimit {
			return nil, badRequest("A room can have up to 20 open invite links. Revoke one first.")
		}
		made, err := invite(app, room, user.Id, o)
		if err != nil {
			return nil, err
		}
		listed, err := openInvites(app, room.Id)
		if err != nil {
			return nil, err
		}
		return map[string]any{"invite": made, "invites": listed}, nil
	})
}

// inviteRevoke deletes one link of the owner's room, so it stops working at once;
// members who joined with it stay. A link already gone changes nothing. The answer
// carries the room's open links.
func inviteRevoke(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, _ *[]string) (any, error) {
		room, err := manager(app, user.Id, b.str("roomId"))
		if err != nil {
			return nil, err
		}
		if link, err := findAs[Invite](app, "room_invites", b.str("inviteId")); err == nil && link.Room() == room.Id {
			if err := app.Delete(link); err != nil {
				return nil, err
			}
		}
		listed, err := openInvites(app, room.Id)
		if err != nil {
			return nil, err
		}
		return map[string]any{"invites": listed}, nil
	})
}

// inviteList is GET /api/odyle/invites/{id}: the open links of the owner's room, from
// any browser. Never their codes: only the browser that made a link can show it.
func inviteList(e *core.RequestEvent) error {
	return run(e, func() error {
		room, err := manager(e.App, e.Auth.Id, e.Request.PathValue("id"))
		if err != nil {
			return err
		}
		listed, err := openInvites(e.App, room.Id)
		if err != nil {
			return err
		}
		return e.JSON(200, map[string]any{"invites": listed})
	})
}

// invitePreview tells whoever opens an invite link what it opens, before they sign in:
// the room, who made the link, the role and how many members the room has. It is public
// and rate limited per address; the code comes in the body, never in a URL, and is
// found by its digest like a join. An expired or used-up link names only its room, a
// code that matches no link nothing.
func invitePreview(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		unknown := map[string]any{"state": "unknown"}
		typed, _ := b.text("code")
		code := normalizeCode(typed)
		if code == "" || length(code) > 20 {
			return e.JSON(200, unknown)
		}
		link, err := firstAs[Invite](e.App, "room_invites", "digest", security.SHA256(code))
		if err != nil {
			if isNoRows(err) {
				return e.JSON(200, unknown)
			}
			return err
		}
		room, err := findAs[Room](e.App, "party_rooms", link.Room())
		if err != nil {
			return e.JSON(200, unknown)
		}
		if !link.Open(time.Now()) {
			return e.JSON(200, map[string]any{"state": "expired", "room": room.Name()})
		}
		members, err := e.App.CountRecords("room_members", dbx.HashExp{"room": room.Id})
		if err != nil {
			return err
		}
		// Only owners make links, so the inviter is the room's owner: the link's maker while
		// they own the room, the new owner after a hand-over (the maker may have left), and
		// the owner for links made before makers were kept or whose maker deleted the account.
		names, err := displayNames(e.App, []string{room.Owner()})
		if err != nil {
			return err
		}
		inviter := names[room.Owner()]
		return e.JSON(200, map[string]any{"state": "valid", "room": room.Name(), "inviter": inviter, "role": link.Role(), "members": members})
	})
}
