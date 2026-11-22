package odyle

import (
	"maps"
	"regexp"
	"slices"
	"testing"
)

// Every language of data/locales.json words every Discord and push text English has, with the
// same placeholders in the same order, and nothing English lacks.
func TestEveryLanguageHasEveryText(t *testing.T) {
	verbs := regexp.MustCompile(`%[a-z]`)
	en := locales["en"]
	if len(en.Discord) == 0 || len(en.Push) == 0 || !knownLanguage("cs") || knownLanguage("xx") || knownLanguage("") {
		t.Fatalf("locales: %v", slices.Sorted(maps.Keys(locales)))
	}
	for language, l := range locales {
		for part, texts := range map[string][2]map[string]string{"discord": {en.Discord, l.Discord}, "push": {en.Push, l.Push}} {
			if !slices.Equal(slices.Sorted(maps.Keys(texts[0])), slices.Sorted(maps.Keys(texts[1]))) {
				t.Errorf("%s %s keys: %v", language, part, slices.Sorted(maps.Keys(texts[1])))
			}
			for key, format := range texts[1] {
				if !slices.Equal(verbs.FindAllString(format, -1), verbs.FindAllString(texts[0][key], -1)) || format == "" {
					t.Errorf("%s %s %s: %q", language, part, key, format)
				}
			}
		}
	}
	// Texts read as they did when they were written in Go.
	if got := say("cs").claimsAhead(2, 5); got != "2/5 do začátku (odhad)" {
		t.Errorf("claimsAhead: %q", got)
	}
	if got := say("xx").connected("Raid %d"); got != "Odyle will remind this channel of planned runs in **Raid %d** before each one starts." {
		t.Errorf("connected: %q", got)
	}
	if got := pushText("cs", "hoursMins", 1, 5); got != "1 h 5 min" {
		t.Errorf("hoursMins: %q", got)
	}
	if got := pushText("de", "run", "Fire Temple", "10 min"); got != "Fire Temple starts in 10 min" {
		t.Errorf("run: %q", got)
	}
}
