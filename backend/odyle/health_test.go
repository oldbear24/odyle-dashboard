package odyle

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestReadersThatListenWithoutReadingAlertTheOperatorOnceUntilTheyReadAgain(t *testing.T) {
	app := newTestApp(t)
	var mu sync.Mutex
	var posted []string
	discord := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var message map[string]any
		_ = json.NewDecoder(r.Body).Decode(&message)
		mu.Lock()
		posted = append(posted, message["content"].(string))
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer discord.Close()
	t.Setenv("ODYLE_DISCORD_WEBHOOK_BASE", discord.URL)

	now := time.Now()
	long := now.Add(-silentFor - time.Minute)
	note := func(session, status string, at time.Time) {
		noteReader(app, session, body{"reader": status, "game": "Steam build 25800038"}, at)
	}
	// a and b have listened to the game since long ago without reading Odyle; their status
	// did not change, so it still counts from then.
	note("a", "listening", long)
	note("a", "listening", now)
	note("b", "listening", long)
	note("b", "listening", now)
	note("c", "reading", now)
	note("d", "waiting", now)
	noteReader(app, "e", body{"reader": "made-up"}, now)
	noteReader(app, "f", body{"reader": "reading", "game": "<b>build</b>"}, now)
	noteReader(app, "g", body{"game": "Steam build 1"}, now)

	summary, problems := readerHealth(app, now)
	if got := asJSON(t, summary); !strings.Contains(got, `"reporting":5`) || !strings.Contains(got, `"connected":4`) || !strings.Contains(got, `"stuck":2`) ||
		!strings.Contains(got, `"statuses":{"listening":2,"reading":2,"waiting":1}`) || !strings.Contains(got, `"games":[{"game":"Steam build 25800038","apps":4}]`) {
		t.Fatalf("summary %s", got)
	}
	if r, ok := readerOf(app, "f", now); !ok || r.game != "" || r.status != "reading" {
		t.Fatalf("a build that is not plain text is left out: %+v", r)
	}
	if _, ok := readerOf(app, "e", now); ok {
		t.Fatal("an unknown status is ignored")
	}
	if !strings.Contains(problems["stuck"], "2 of 4 apps connected to the game have read no Odyle for 10 minutes (Steam build 25800038)") {
		t.Fatalf("problems %v", problems)
	}

	// Without a webhook the job tells nobody; a wrong one is a failure the jobs page shows.
	t.Setenv("ODYLE_ALERT_WEBHOOK", "")
	if out, err := checkHealth(app); err != nil || out.Skipped != "off" {
		t.Fatalf("off: %v, %v", out, err)
	}
	t.Setenv("ODYLE_ALERT_WEBHOOK", "https://example.com/hook")
	if _, err := checkHealth(app); err == nil {
		t.Fatal("a webhook that is not Discord's is refused")
	}

	// The problem is told once, and once more when it clears.
	t.Setenv("ODYLE_ALERT_WEBHOOK", discord.URL+"/api/webhooks/12345/abcdefghijklmnopqrstuvwx")
	if out, err := checkHealth(app); err != nil || out.Done != 1 {
		t.Fatalf("first: %v, %v", out, err)
	}
	if out, err := checkHealth(app); err != nil || out.Done != 0 {
		t.Fatalf("told again: %v, %v", out, err)
	}
	note("a", "reading", now)
	note("b", "reading", now)
	if out, err := checkHealth(app); err != nil || out.Done != 1 {
		t.Fatalf("cleared: %v, %v", out, err)
	}
	mu.Lock()
	if len(posted) != 2 || !strings.HasPrefix(posted[0], "Odyle alert: 2 of 4 apps") || posted[1] != "Odyle: cleared, the apps read Odyle again." {
		t.Fatalf("posted %q", posted)
	}
	mu.Unlock()

	// One stuck reader among many is no alert; reports end with their session's contact.
	note("a", "listening", long)
	note("a", "listening", now)
	if _, problems := readerHealth(app, now); len(problems) != 0 {
		t.Fatalf("one stuck reader: %v", problems)
	}
	if summary, _ := readerHealth(app, now.Add(presenceKept+time.Minute)); !strings.Contains(asJSON(t, summary), `"reporting":0`) {
		t.Fatalf("old reports stay: %s", asJSON(t, summary))
	}
}

func TestReadingsUnderARefusedAdapterAlertTheOperator(t *testing.T) {
	app := newTestApp(t)
	remember(app, newObject().set("kind", "report").set("parserVersion", "global-reference-v9").set("ok", false).set("at", now()))
	remember(app, newObject().set("kind", "report").set("parserVersion", acceptedAdapters(app)[0]).set("ok", true).set("at", now()))
	summary, problems := readerHealth(app, time.Now())
	if len(problems) != 1 || !strings.Contains(problems["adapter:global-reference-v9"], "global-reference-v9, which this backend refuses") || !strings.Contains(asJSON(t, summary), `"refusedAdapters":["global-reference-v9"]`) {
		t.Fatalf("%v %s", problems, asJSON(t, summary))
	}
}
