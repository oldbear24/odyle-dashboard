package odyle

import (
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/tools/security"
)

// Planned-run reminders in a room's Discord channel, through a webhook its owner
// connects under Room settings. The backend posts a test message when the webhook is
// saved and each run 15 minutes before it starts. Discord renders <t:…> timestamps in
// every reader's own time zone; mentions are switched off, so names and notes can
// never ping anyone. ODYLE_DISCORD_WEBHOOK_BASE replaces https://discord.com for tests.

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

// Discord markdown would let a dungeon or display name format the whole message.
var markdown = regexp.MustCompile(`([\\*_~` + "`" + `|>#\[\]()])`)

func plain(text string) string { return markdown.ReplaceAllString(text, `\$1`) }

type words struct {
	connected func(room string) string
	starts    string
	going     func(n int) string
	nobody    string
	footer    func(room string) string
}

var languages = map[string]words{
	"en": {connected: func(room string) string {
		return "Odyle will remind this channel of planned runs in **" + room + "**, 15 minutes before each one starts."
	}, starts: "Starts", going: func(n int) string { return "Going (" + strconv.Itoa(n) + ")" }, nobody: "Nobody yet", footer: func(room string) string { return "Odyle · " + room }},
	"cs": {connected: func(room string) string {
		return "Odyle bude tomuto kanálu připomínat plánované běhy místnosti **" + room + "**, 15 minut před začátkem každého."
	}, starts: "Začíná", going: func(n int) string { return "Jdou (" + strconv.Itoa(n) + ")" }, nobody: "Zatím nikdo", footer: func(room string) string { return "Odyle · " + room }},
}

func say(language string) words {
	if w, ok := languages[language]; ok {
		return w
	}
	return languages["en"]
}

// postWebhook sends one message and answers Discord's answer.
func postWebhook(link string, payload map[string]any) (response, error) {
	message := newObject().set("allowed_mentions", map[string]any{"parse": []any{}})
	for _, key := range []string{"content", "embeds"} {
		if v, ok := payload[key]; ok {
			message.set(key, v)
		}
	}
	raw, err := json.Marshal(message)
	if err != nil {
		return response{}, err
	}
	return send(call{method: "POST", url: link + "?wait=true", headers: map[string]string{"content-type": "application/json", "user-agent": userAgent}, payload: raw, timeout: 10 * time.Second, limit: 64 << 10})
}

// connectWebhook makes the test post of a newly connected webhook; it fails when
// Discord refuses it.
func connectWebhook(link, roomName, language string) error {
	res, err := postWebhook(link, map[string]any{"content": say(language).connected(plain(roomName))})
	if err != nil {
		return badRequest("Discord could not be reached. Try again in a minute.")
	}
	if res.status == http.StatusTooManyRequests {
		return badRequest("Discord asked to slow down. Try again in a minute.")
	}
	if res.status < 200 || res.status >= 300 {
		return badRequest("Discord did not accept this webhook. Copy it again from the channel settings.")
	}
	return nil
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

func reminder(roomName, dungeon, startsAt, note string, going []string, language string) map[string]any {
	w := say(language)
	at, _ := parseDate(strings.Replace(startsAt, " ", "T", 1))
	unix := strconv.FormatInt(at.Unix(), 10)
	description := w.starts + " <t:" + unix + ":R> · <t:" + unix + ":f>"
	if note != "" {
		description += "\n" + plain(note)
	}
	names := w.nobody
	if len(going) > 0 {
		escaped := make([]string, len(going))
		for i, name := range going {
			escaped[i] = plain(name)
		}
		names = cut(strings.Join(escaped, ", "), 1000)
	}
	embed := newObject().set("title", plain(dungeon)).set("color", 0x5ee0b0).set("description", description).
		set("fields", []any{newObject().set("name", w.going(len(going))).set("value", names)}).
		set("footer", newObject().set("text", cut(w.footer(roomName), 200)))
	return map[string]any{"embeds": []any{embed}}
}
