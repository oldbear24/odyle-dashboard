package odyle

import (
	"strings"
	"testing"
	"time"
)

func readingInput(change map[string]any) body {
	b := body{"sessionId": "session", "sequence": 6.0, "source": "packet", "parserVersion": "test-fixture-v1", "confirmed": true, "region": "GLOBAL_EU", "server": "EU", "characterName": "Tester", "value": 0.0}
	for k, v := range change {
		b[k] = v
	}
	return b
}

func TestReadingKeepsConfirmedZero(t *testing.T) {
	r, err := validReading(readingInput(nil), "session", 5, []string{"test-fixture-v1"})
	if err != nil || r.value != 0 || r.sequence != 6 || r.characterName != "Tester" {
		t.Fatalf("reading = %+v, %v", r, err)
	}
}

func TestReadingRejectsStaleManualUnverifiedAndFractionalValues(t *testing.T) {
	for _, change := range []map[string]any{{"sequence": 5.0}, {"sessionId": "old"}, {"source": "manual"}, {"parserVersion": "unverified"}, {"value": -1.0}, {"value": 1.5}, {"value": nil}, {"confirmed": false}, {"characterName": ""}, {"region": "KR"}, {"sequence": "6"}} {
		if _, err := validReading(readingInput(change), "session", 5, []string{"test-fixture-v1"}); err == nil {
			t.Errorf("accepted %v", change)
		}
	}
}

func TestDungeonsAreKeyedRegardlessOfCaseAndSpacing(t *testing.T) {
	d, err := dungeon("  Fire   Temple ")
	if err != nil || d.dungeon != "Fire Temple" || d.key != "fire temple" {
		t.Fatalf("dungeon = %+v, %v", d, err)
	}
	if a, _ := dungeon("FIRE\tTEMPLE"); a.key != d.key {
		t.Errorf("key %q differs from %q", a.key, d.key)
	}
	for _, bad := range []any{"", "   ", strings.Repeat("x", 61), nil, 42.0} {
		if _, err := dungeon(bad); err == nil {
			t.Errorf("accepted %v", bad)
		}
	}
}

func TestTasksAreShortFreeTextWithACadence(t *testing.T) {
	title, cadence, err := task("  Lugbug   daily ", "daily")
	if err != nil || title != "Lugbug daily" || cadence != "daily" {
		t.Fatalf("task = %q %q %v", title, cadence, err)
	}
	if _, cadence, _ := task("Weekly boss", "weekly"); cadence != "weekly" {
		t.Errorf("cadence = %q", cadence)
	}
	for _, bad := range [][2]any{{"", "daily"}, {strings.Repeat("x", 61), "weekly"}, {"Run", "monthly"}, {"Run", nil}, {42.0, "daily"}} {
		if _, _, err := task(bad[0], bad[1]); err == nil {
			t.Errorf("accepted %v", bad)
		}
	}
}

// Limits count UTF-16 code units like the browser: an emoji is two.
func TestTextLimitsCountLikeTheBrowser(t *testing.T) {
	if _, err := text(strings.Repeat("😀", 20), "Character", 40); err != nil {
		t.Errorf("20 emoji are 40 units: %v", err)
	}
	if _, err := text(strings.Repeat("😀", 20)+"x", "Character", 40); err == nil {
		t.Error("41 units accepted")
	}
	if got, _ := text("\u00a0 Lumina \ufeff", "Character", 40); got != "Lumina" {
		t.Errorf("trimmed to %q", got)
	}
	if got, _ := displayName(" Life \n\t keeper "); got != "Life keeper" {
		t.Errorf("collapsed to %q", got)
	}
}

func TestRunsStartFromAnHourAgoUpToSixtyDaysAhead(t *testing.T) {
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	for value, want := range map[string]string{
		"2026-10-15T13:00:00.000Z":  "2026-10-15T13:00:00.000Z",
		"2026-10-15T13:00:00Z":      "2026-10-15T13:00:00.000Z",
		"2026-10-15T15:30:00+02:00": "2026-10-15T13:30:00.000Z",
		"2026-10-15 11:15:00.000Z":  "2026-10-15T11:15:00.000Z",
		"2026-12-14":                "2026-12-14T00:00:00.000Z",
	} {
		if got, err := runStart(value, now); err != nil || got != want {
			t.Errorf("runStart(%q) = %q, %v; want %q", value, got, err, want)
		}
	}
	for _, bad := range []any{"tomorrow", "soon", "2026-10-15T10:59:00Z", "2026-12-15T00:00:01Z", "2026-02-30T10:00:00Z", 1797336000000.0, nil} {
		if _, err := runStart(bad, now); err == nil {
			t.Errorf("accepted %v", bad)
		}
	}
}

func TestNotesAreOptional(t *testing.T) {
	for _, b := range []body{{}, {"note": nil}, {"note": "   "}} {
		if n, err := note(b, "note"); err != nil || n != "" {
			t.Errorf("note(%v) = %q, %v", b, n, err)
		}
	}
	if n, _ := note(body{"note": " Bring   potions "}, "note"); n != "Bring potions" {
		t.Errorf("note = %q", n)
	}
	if _, err := note(body{"note": strings.Repeat("x", 121)}, "note"); err == nil {
		t.Error("121 characters accepted")
	}
}

func TestWebhooksMustBeDiscordWebhooks(t *testing.T) {
	good := "https://discord.com/api/webhooks/123456789012/" + strings.Repeat("a", 68)
	for _, link := range []string{good, " " + good + " ", strings.Replace(good, "discord.com", "canary.discordapp.com", 1)} {
		if got, err := webhook(link); err != nil || got != strings.TrimSpace(link) {
			t.Errorf("webhook(%q) = %q, %v", link, got, err)
		}
	}
	for _, link := range []string{"https://example.com/api/webhooks/1/2", "http://discord.com/api/webhooks/123456789012/" + strings.Repeat("a", 68), "https://discord.com/api/other"} {
		if _, err := webhook(link); apiStatus(err) != 400 {
			t.Errorf("webhook(%q) = %v", link, err)
		}
	}
	if got, err := webhook(""); got != "" || err != nil {
		t.Errorf("empty webhook = %q, %v", got, err)
	}
}

func TestNamesCannotFormatDiscordMessages(t *testing.T) {
	if got := plain("Run *mate* [x](y) `z`"); got != "Run \\*mate\\* \\[x\\]\\(y\\) \\`z\\`" {
		t.Errorf("plain = %q", got)
	}
}

func TestAppVersionsAndDeviceNamesAreCleanedNotRefused(t *testing.T) {
	for value, want := range map[any]string{" 0.6.0.12 ": "0.6.0.12", "1.2": "1.2", "v1.2": "", "1": "", 7.0: ""} {
		if got := appVersion(value); got != want {
			t.Errorf("appVersion(%v) = %q", value, got)
		}
	}
	if got := deviceName("  Gaming   PC  "); got != "Gaming PC" {
		t.Errorf("deviceName = %q", got)
	}
	if got := deviceName(42.0); got != "" {
		t.Errorf("deviceName(42) = %q", got)
	}
	if got := deviceName(strings.Repeat("x", 50)); length(got) != 40 {
		t.Errorf("deviceName kept %d characters", length(got))
	}
}

func TestCodesIgnoreSpacesDashesAndCase(t *testing.T) {
	if got := normalizeCode(" abcd-efgh 2345 "); got != "ABCDEFGH2345" {
		t.Errorf("normalizeCode = %q", got)
	}
}
