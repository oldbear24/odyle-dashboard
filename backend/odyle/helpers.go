package odyle

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// Timestamps. Responses carry ISO times ('2026-10-13T21:40:00.000Z'); date fields
// are stored as '2026-10-13 21:40:00.000Z' and filters compare them as strings,
// so filter params must use the same space-separated form (stamp), not ISO 'T'.
const isoLayout, stampLayout = "2006-01-02T15:04:05.000Z", "2006-01-02 15:04:05.000Z"

func now() string { return time.Now().UTC().Format(isoLayout) }

// expiry is the time the given number of seconds from now.
func expiry(seconds int) string {
	return time.Now().Add(time.Duration(seconds) * time.Second).UTC().Format(isoLayout)
}

func stamp(t time.Time) string { return t.UTC().Format(stampLayout) }

// ago is the stored form of the time d before now.
func ago(d time.Duration) string { return stamp(time.Now().Add(-d)) }

// Error answers. Messages passed as literals are checked for a Czech translation
// by tests/i18n.test.cjs, like errors.New messages.
func badRequest(message string) error   { return apis.NewBadRequestError(message, nil) }
func forbidden(message string) error    { return apis.NewForbiddenError(message, nil) }
func notFound(message string) error     { return apis.NewNotFoundError(message, nil) }
func unauthorized(message string) error { return apis.NewUnauthorizedError(message, nil) }

// unavailable answers 503: superusers switched the part off for now (Server controls).
func unavailable(message string) error { return apis.NewApiError(503, message, nil) }

// apiStatus is the status of an error meant for the client (400, 401, 403, 404, 503), or 0.
func apiStatus(err error) int {
	var apiErr *router.ApiError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case 400, 401, 403, 404, 503:
			return apiErr.Status
		}
	}
	return 0
}

// message is the text clients see for an error.
func message(err error) string {
	var apiErr *router.ApiError
	if errors.As(err, &apiErr) {
		return apiErr.Message
	}
	return err.Error()
}

func isNoRows(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "no rows in result set")
}

// list finds up to 500 records of a collection by filter, in id order.
func list(app core.App, name, filter string, params dbx.Params) ([]*core.Record, error) {
	return app.FindRecordsByFilter(name, filter, "id", 500, 0, params)
}

// all finds every record of a collection by filter, oldest first.
func all(app core.App, name, filter string, params dbx.Params) ([]*core.Record, error) {
	return app.FindRecordsByFilter(name, filter, "created", 0, 0, params)
}

func ids(records []*core.Record) []string {
	out := make([]string, len(records))
	for i, r := range records {
		out[i] = r.Id
	}
	return out
}

func unique(values []string) []string {
	seen, out := map[string]bool{}, []string{}
	for _, v := range values {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func anys(values []string) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}

func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

// stringSlice is a relation or select list of a record, never nil, so it answers [] in JSON.
func stringSlice(r *core.Record, key string) []string {
	if s := r.GetStringSlice(key); s != nil {
		return s
	}
	return []string{}
}

// ---------------------------------------------------------------- request bodies
//
// Bodies arrive as JSON objects (numbers as float64). These helpers keep the
// clients' contract exact: what counts as given, true, a string or an integer.

type body map[string]any

// has reports whether the key was sent at all (null included).
func (b body) has(key string) bool { _, ok := b[key]; return ok }

// set reports whether the key was sent with a truthy value (a non-empty string,
// a non-zero number, true, a list or an object).
func (b body) set(key string) bool {
	switch v := b[key].(type) {
	case nil:
		return false
	case string:
		return v != ""
	case float64:
		return v != 0 && !math.IsNaN(v)
	case bool:
		return v
	}
	return true
}

// str is the value as text, the way ids from clients are compared: strings as they
// are, numbers and booleans spelled out, and "undefined" when the key is missing.
func (b body) str(key string) string {
	v, ok := b[key]
	if !ok {
		return "undefined"
	}
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			parts[i] = body{"v": item}.str("v")
			if item == nil {
				parts[i] = ""
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

func (b body) isTrue(key string) bool { v, ok := b[key].(bool); return ok && v }

func (b body) boolean(key string) (bool, bool) { v, ok := b[key].(bool); return v, ok }

func (b body) text(key string) (string, bool) { v, ok := b[key].(string); return v, ok }

func requestBody(e *core.RequestEvent) (body, error) {
	info, err := e.RequestInfo()
	if err != nil {
		return nil, err
	}
	if info.Body == nil {
		return body{}, nil
	}
	return body(info.Body), nil
}

// ---------------------------------------------------------------- text
//
// Limits count UTF-16 code units and whitespace follows the browser's definition,
// so the backend measures names and notes exactly like the dashboard does.

func isSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
		return true
	}
	return r >= '\u2000' && r <= '\u200a'
}

func trim(s string) string { return strings.TrimFunc(s, isSpace) }

// collapse turns every run of whitespace into one space.
func collapse(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		if isSpace(r) {
			if !space {
				b.WriteByte(' ')
			}
			space = true
			continue
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

func length(s string) int { return len(utf16.Encode([]rune(s))) }

// cut keeps the first n UTF-16 code units of s.
func cut(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}

// ---------------------------------------------------------------- JSON

// object is a JSON object that keeps its keys in insertion order.
type object struct {
	keys   []string
	values map[string]any
}

func newObject() *object { return &object{values: map[string]any{}} }

func (o *object) set(key string, value any) *object {
	if _, ok := o.values[key]; !ok {
		o.keys = append(o.keys, key)
	}
	o.values[key] = value
	return o
}

func (o *object) get(key string) (any, bool) { v, ok := o.values[key]; return v, ok }

func (o *object) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		key, _ := json.Marshal(k)
		value, err := json.Marshal(o.values[k])
		if err != nil {
			return nil, err
		}
		b.Write(key)
		b.WriteByte(':')
		b.Write(value)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

// parseJSON reads a JSON value, or returns fallback when raw is empty or invalid.
func parseJSON(raw, fallback string) any {
	if raw == "" {
		raw = fallback
	}
	var v any
	if json.Unmarshal([]byte(raw), &v) != nil {
		_ = json.Unmarshal([]byte(fallback), &v)
	}
	return v
}
