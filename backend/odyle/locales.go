package odyle

import "fmt"

// The texts the server words itself, in each language players choose: Discord posts
// (discordtext.go) and Web Push messages (pushsend.go). They live in data/locales.json, one block
// per language with every key English has, as fmt formats; a language added there is offered to
// rooms and push subscriptions at once. A key a language leaves out reads in English.

// locale is one language's texts.
type locale struct {
	Discord map[string]string `json:"discord"`
	Push    map[string]string `json:"push"`
}

var locales = embeddedJSON[map[string]locale]("data/locales.json")

// knownLanguage reports whether the server has texts in the language.
func knownLanguage(language string) bool {
	_, ok := locales[language]
	return ok
}

func discordTexts(l locale) map[string]string { return l.Discord }
func pushTexts(l locale) map[string]string    { return l.Push }

// localeText is one text in a language (English for a language or key it does not have), filled
// in with args.
func localeText(language string, part func(locale) map[string]string, key string, args ...any) string {
	format, ok := part(locales[language])[key]
	if !ok {
		format = part(locales["en"])[key]
	}
	return fmt.Sprintf(format, args...)
}
