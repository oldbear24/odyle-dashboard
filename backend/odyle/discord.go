package odyle

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
)

// Planned-run reminders in a room's Discord channel, through a webhook its owner connects
// under Room settings. The backend posts a test message when the webhook is saved and each
// run at the room's lead times (up to three, 15 minutes until chosen), and when it starts if
// the room asks for that. A post links back to the room (with the server's Application URL),
// is edited when the run changes and marked when it is cancelled or done (#33). Discord
// renders <t:…> timestamps in every reader's own time zone. Names and notes never ping
// anyone: only Going attendees who turned the Discord channel on in their notification
// settings are mentioned, by their Discord id, and only in the first post (#34).
// ODYLE_DISCORD_WEBHOOK_BASE replaces https://discord.com for tests.

var webhookPath = regexp.MustCompile(`^/api/webhooks/\d{5,30}/[\w-]{20,120}$`)
var discordHost = regexp.MustCompile(`^https://(?:(?:ptb|canary)\.)?discord(?:app)?\.com(/.*)$`)

func webhook(value any) (string, error) {
	s, _ := value.(string)
	link := trim(s)
	if link == "" {
		return "", nil
	}
	if test := os.Getenv("ODYLE_DISCORD_WEBHOOK_BASE"); test != "" && strings.HasPrefix(link, test+"/") && webhookPath.MatchString(link[len(test):]) {
		return link, nil
	}
	if m := discordHost.FindStringSubmatch(link); m == nil || !webhookPath.MatchString(m[1]) {
		return "", badRequest("Paste a Discord webhook URL (https://discord.com/api/webhooks/…).")
	}
	return link, nil
}

// discordLeadChoices are the times before a run a room can choose for its reminders, in minutes.
var discordLeadChoices = []int64{5, 10, 15, 30, 60, 120}

// checkLeads validates a room's reminder times: one to three of the choices, largest first.
func checkLeads(value any) ([]int64, error) {
	list, ok := value.([]any)
	if !ok || len(list) == 0 || len(list) > 3 {
		return nil, badRequest("Choose one to three reminder times.")
	}
	out := []int64{}
	for _, v := range list {
		n, ok := v.(float64)
		lead := int64(n)
		if !ok || float64(lead) != n || !slices.Contains(discordLeadChoices, lead) {
			return nil, badRequest("Choose reminder times from the list.")
		}
		if slices.Contains(out, lead) {
			return nil, badRequest("Choose different reminder times.")
		}
		out = append(out, lead)
	}
	slices.Sort(out)
	slices.Reverse(out)
	return out, nil
}

// postWebhook sends one message and answers Discord's answer. Only the ids in mentions can
// be pinged.
func postWebhook(link string, payload map[string]any, mentions []string) (response, error) {
	return sendWebhook("POST", link+"?wait=true", payload, mentions)
}

// editWebhook changes a message the webhook posted; its mentions line stays and pings nobody again.
func editWebhook(link, messageId string, payload map[string]any) (response, error) {
	return sendWebhook("PATCH", link+"/messages/"+messageId, map[string]any{"embeds": payload["embeds"]}, nil)
}

func sendWebhook(method, link string, payload map[string]any, mentions []string) (response, error) {
	allowed := map[string]any{"parse": []any{}}
	if len(mentions) > 0 {
		allowed["users"] = mentions
	}
	message := newObject().set("allowed_mentions", allowed)
	for _, key := range []string{"content", "embeds"} {
		if v, ok := payload[key]; ok {
			message.set(key, v)
		}
	}
	raw, err := json.Marshal(message)
	if err != nil {
		return response{}, err
	}
	return send(call{method: method, url: link, headers: map[string]string{"content-type": "application/json", "user-agent": userAgent}, payload: raw, timeout: 10 * time.Second, limit: 64 << 10})
}

// connectWebhook makes the test post of a newly connected webhook and answers the webhook's
// name in Discord ("" when Discord does not say); it fails when Discord refuses the post.
func connectWebhook(link, roomName, language string) (string, error) {
	res, err := postWebhook(link, map[string]any{"content": say(language).connected(plain(roomName))}, nil)
	if err != nil {
		return "", badRequest("Discord could not be reached. Try again in a minute.")
	}
	if res.status == http.StatusTooManyRequests {
		return "", badRequest("Discord asked to slow down. Try again in a minute.")
	}
	if res.status < 200 || res.status >= 300 {
		return "", badRequest("Discord did not accept this webhook. Copy it again from the channel settings.")
	}
	name := ""
	if found, err := send(call{method: "GET", url: link, headers: map[string]string{"user-agent": userAgent}, timeout: 10 * time.Second, limit: 64 << 10}); err == nil && found.status == 200 {
		if body, ok := found.json().(map[string]any); ok {
			name = cut(textOf(body["name"]), 100)
		}
	}
	return name, nil
}

// Discord limits how often a webhook posts and answers 429 with how long to wait, for
// that webhook or, when the limit is global, for all of them. The reminders job leaves
// a waiting webhook alone until then; its runs stay due for a later run.
type webhookWaits struct {
	mu    sync.Mutex
	until map[string]time.Time // by webhook digest; "*" for every webhook
}

func (w *webhookWaits) waiting(link string, at time.Time) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return at.Before(w.until[security.SHA256(link)]) || at.Before(w.until["*"])
}

func (w *webhookWaits) wait(link string, res response, at time.Time) time.Duration {
	wait := max(retryAfter(res), time.Second)
	key := security.SHA256(link)
	if strings.EqualFold(res.header.Get("X-RateLimit-Global"), "true") {
		key = "*"
	} else if body, ok := res.json().(map[string]any); ok && body["global"] == true {
		key = "*"
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.until == nil {
		w.until = map[string]time.Time{}
	}
	for k, until := range w.until {
		if !at.Before(until) {
			delete(w.until, k)
		}
	}
	w.until[key] = at.Add(wait)
	return wait
}

// runPost is what a reminder shows: the run as it is now, or as it was once it ended.
type runPost struct {
	room, dungeon, startsAt, note string
	going                         []string // its party (runParty), in the order they answered
	waiting                       []string // those going beyond the party size, first come first
	lead                          int64    // minutes before the start; 0: it starts now
	ended                         string   // "", "cancelled" or "done"
	link                          string   // the room on the dashboard; "" without an Application URL
	event                         string   // the run's event elsewhere (#35)
	mentions                      []string
	// Readiness, when the room shows it (#46): how many of those going can claim a cube at the
	// start (now, once it started). Counts only: the channel may include people outside the room.
	readiness, started bool
	claim, of          int
}

// claimsKey is what a post shows of readiness, kept on the post so it is edited only when that changes.
func (p runPost) claimsKey() string {
	if !p.readiness || p.of == 0 {
		return ""
	}
	return fmt.Sprintf("%d/%d/%t", p.claim, p.of, p.started)
}

// configureDiscord enables Discord sign-in from DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.
func configureDiscord(app core.App) error {
	clientId, clientSecret := os.Getenv("DISCORD_CLIENT_ID"), os.Getenv("DISCORD_CLIENT_SECRET")
	if clientId == "" || clientSecret == "" {
		return nil
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.OAuth2.Enabled, users.OAuth2.Providers = true, []core.OAuth2ProviderConfig{{Name: "discord", ClientId: clientId, ClientSecret: clientSecret}}
	return app.Save(users)
}

// discordWebhook lets the room owner connect a Discord channel webhook ({ roomId,
// webhook, language }) or disconnects it (an empty webhook), and choose when runs are posted
// ({ leads: one to three of 5, 10, 15, 30, 60 and 120 minutes, startPost }, with a webhook or
// alone). A test post proves the webhook before it is saved and gives its name in Discord; it
// runs outside a transaction because it waits on Discord. No response carries the URL.
func discordWebhook(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		room, err := manager(e.App, e.Auth.Id, b.str("roomId"))
		if err != nil {
			return err
		}
		// Everything is checked, and Discord asked, before the room is written: the changes
		// are then made to a fresh copy in one transaction, so a rename, a room setting or a
		// delivery noted while Discord answered is kept.
		var leads []int64
		if b.has("leads") {
			if leads, err = checkLeads(b["leads"]); err != nil {
				return err
			}
		}
		start, setStart := b.boolean("startPost")
		ready, setReady := b.boolean("readiness")
		// The posts' language alone (#50): later posts use it, and the room's posts still showing
		// a run are edited into it.
		language, setLanguage := "", !b.has("webhook") && b.has("language")
		if setLanguage {
			language, _ = b.text("language")
			if !knownLanguage(language) {
				return badRequest("Choose English or Czech for the Discord posts.")
			}
		}
		url, name := "", ""
		if b.has("webhook") {
			if url, err = webhook(b["webhook"]); err != nil {
				return err
			}
			language = "en"
			if l, _ := b.text("language"); knownLanguage(l) {
				language = l
			}
			if url != "" {
				if name, err = connectWebhook(url, room.Name(), language); err != nil {
					return err
				}
			}
		}
		relabel := false
		if err := e.App.RunInTransaction(func(tx core.App) error {
			if room, err = manager(tx, e.Auth.Id, room.Id); err != nil {
				return err
			}
			if b.has("leads") {
				room.Set("discordLeads", leads)
			}
			if setStart {
				room.Set("discordStartPost", start)
			}
			if setReady {
				room.Set("discordReadiness", ready)
			}
			if setLanguage {
				relabel = room.DiscordWebhook() != "" && language != room.DiscordLanguage()
				room.Set("discordLanguage", language)
			}
			if b.has("webhook") {
				if url != "" {
					// A new webhook starts with a clean record.
					room.Set("discordStatus", deliveryStatus{OkAt: now()})
				}
				room.SetDiscord(url, language)
				room.Set("discordName", name)
			}
			return tx.Save(room)
		}); err != nil {
			return err
		}
		if relabel {
			if _, err := e.App.DB().NewQuery("UPDATE discord_posts SET " + markDirty + " WHERE room = {:room} AND messageId != '' AND ended = ''").Bind(dbx.Params{"room": room.Id, "marked": stamp(time.Now())}).Execute(); err != nil {
				warn(e.App, "Odyle could not mark Discord posts for an edit", "room", room.Id, "error", err.Error())
			}
		}
		notify(e.App, []string{room.Id})
		if room.DiscordWebhook() != "" {
			_ = e.App.RunInTransaction(func(tx core.App) error { achieved(tx, e.Auth.Id, nil, true); return nil })
		}
		return e.JSON(200, map[string]any{"room": roomJSON(room, odylePerCube(e.App))})
	})
}
