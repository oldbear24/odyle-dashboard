package odyle

import (
	"encoding/json"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
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

// postWebhook sends one message and answers Discord's status.
func postWebhook(link string, payload map[string]any) (int, error) {
	message := newObject().set("allowed_mentions", map[string]any{"parse": []any{}})
	for _, key := range []string{"content", "embeds"} {
		if v, ok := payload[key]; ok {
			message.set(key, v)
		}
	}
	raw, err := json.Marshal(message)
	if err != nil {
		return 0, err
	}
	res, err := send("POST", link+"?wait=true", map[string]string{"content-type": "application/json", "user-agent": userAgent}, raw, 10*time.Second)
	if err != nil {
		return 0, err
	}
	return res.status, nil
}

// connectWebhook makes the test post of a newly connected webhook; it fails when
// Discord refuses it.
func connectWebhook(link, roomName, language string) error {
	status, err := postWebhook(link, map[string]any{"content": say(language).connected(plain(roomName))})
	if err != nil {
		return badRequest("Discord could not be reached. Try again in a minute.")
	}
	if status < 200 || status >= 300 {
		return badRequest("Discord did not accept this webhook. Copy it again from the channel settings.")
	}
	return nil
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
