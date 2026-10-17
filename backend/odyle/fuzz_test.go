package odyle

import (
	"encoding/json"
	"math"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

// Fuzz tests: go test runs their seeds; CI also fuzzes each for a few seconds
// (go test -run '^$' -fuzz '^FuzzName$' -fuzztime 10s ./odyle).

func FuzzTextLimits(f *testing.F) {
	for _, s := range []string{"", " Lumiel ", "a\u00a0b \t c", "😀😀x", "x\ufeffy", "\u2028\u3000", "\xff\xfe", "\u202eevil", "a\u200bb", "👩\u200d💻"} {
		f.Add(s, 3)
	}
	f.Fuzz(func(t *testing.T, s string, n int) {
		n = int(math.Abs(float64(n % 200)))
		short := cut(s, n)
		if length(short) > n {
			t.Fatalf("cut(%q, %d) = %q, %d units", s, n, short, length(short))
		}
		if length(s) <= n && short != s {
			t.Fatalf("cut(%q, %d) changed a short text to %q", s, n, short)
		}
		if trim(trim(s)) != trim(s) || collapse(collapse(s)) != collapse(s) {
			t.Fatalf("trim or collapse of %q is not stable", s)
		}
		if got, err := text(s, "Name", n); err == nil && (got != trim(got) || got == "" || length(got) > n || strings.ContainsFunc(got, invisible)) {
			t.Fatalf("text(%q, %d) accepted %q", s, n, got)
		}
		if strings.ContainsFunc(collapse(s), invisible) {
			t.Fatalf("collapse(%q) kept an invisible character", s)
		}
	})
}

func FuzzParseDate(f *testing.F) {
	for _, s := range []string{"2026-10-15T12:00:00.000Z", "2026-10-15 12:00", "2026-02-30T10:00:00Z", "2026-10-15T23:59:59.123456789+02:00", "2026-10-15", "bad"} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		at, ok := parseDate(s)
		if !ok || at.UTC().Year() < 1 || at.UTC().Year() > 9999 {
			return
		}
		again, ok := parseDate(at.UTC().Format(isoLayout))
		if !ok || !again.Equal(at.Truncate(time.Millisecond)) {
			t.Fatalf("%q: %v did not read back (%v, %v)", s, at, again, ok)
		}
	})
}

var acceptedWebhook = regexp.MustCompile(`^https://(?:(?:ptb|canary)\.)?discord(?:app)?\.com/api/webhooks/\d{5,30}/[\w-]{20,120}$`)

func FuzzWebhook(f *testing.F) {
	os.Unsetenv("ODYLE_DISCORD_WEBHOOK_BASE")
	for _, s := range []string{"https://discord.com/api/webhooks/123456789012/" + "a1_-b2c3d4e5f6g7h8i9j0k", " https://ptb.discord.com/api/webhooks/12345/abcdefghijklmnopqrstu\n", "https://example.com/api/webhooks/1/2", "http://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuv", ""} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		if link, err := webhook(s); err == nil && link != "" && !acceptedWebhook.MatchString(link) {
			t.Fatalf("webhook(%q) accepted %q", s, link)
		}
	})
}

func FuzzReading(f *testing.F) {
	f.Add(390.0, 1.0, "Lumina", "Lumiel", "GLOBAL_EU", "global-reference-v1", true)
	f.Add(-1.0, 0.5, " ", "", "GLOBAL_XX", "unknown", false)
	f.Add(1e6+1, 9007199254740993.0, "😀", "Lumiel", "GLOBAL_NA", "global-reference-v1", true)
	f.Fuzz(func(t *testing.T, value, sequence float64, name, server, region, adapter string, confirmed bool) {
		b := body{"sessionId": "s", "sequence": sequence, "value": value, "characterName": name, "server": server, "region": region, "parserVersion": adapter, "source": "packet", "confirmed": confirmed}
		r, err := validReading(b, "s", 0, []string{"global-reference-v1"})
		if err != nil {
			return
		}
		if r.value < 0 || r.value > 1000000 || float64(r.value) != value || r.sequence < 1 || !contains(regions, r.region) || r.parserVersion != "global-reference-v1" ||
			r.characterName == "" || length(r.characterName) > 40 || r.server == "" || length(r.server) > 40 {
			t.Fatalf("accepted %+v from %v", r, b)
		}
	})
}

// The body helpers keep the clients' JavaScript-era contract for any JSON a client sends.
func FuzzBody(f *testing.F) {
	for _, s := range []string{`{"v":"x"}`, `{"v":1.5}`, `{"v":null}`, `{"v":[1,null,"a",[2]]}`, `{"v":{"a":1}}`, `{}`, `{"v":true}`} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		var b body
		if json.Unmarshal([]byte(raw), &b) != nil {
			return
		}
		got := b.str("v")
		if _, ok := b["v"]; !ok && got != "undefined" {
			t.Fatalf("a missing field reads %q", got)
		}
		if s, ok := b["v"].(string); ok && (got != s || b.set("v") != (s != "")) {
			t.Fatalf("a string reads %q, set %v", got, b.set("v"))
		}
	})
}
