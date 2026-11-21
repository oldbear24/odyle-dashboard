package odyle

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
)

// A route's errors: those meant for the client keep their status and words, a record deleted
// meanwhile is 404, and anything else (a locked database, a broken constraint) answers 500
// without its text, which stays in the log.
func TestRoutesAnswerUnexpectedErrorsWith500(t *testing.T) {
	app := newTestApp(t)
	user := newUser(t, app, "Runner")
	answer := func(err error) (int, string) {
		t.Helper()
		e := &core.RequestEvent{App: app, Auth: user, Event: router.Event{Response: httptest.NewRecorder(), Request: httptest.NewRequest(http.MethodPost, "/api/odyle/plan", nil)}}
		var apiErr *router.ApiError
		if !errors.As(run(e, func() error { return err }), &apiErr) {
			t.Fatalf("%v: not an API error", err)
		}
		return apiErr.Status, apiErr.Message
	}
	for _, c := range []struct {
		err     error
		status  int
		message string
	}{
		{badRequest("Choose a dungeon from the list."), 400, "Choose a dungeon from the list."},
		{fmt.Errorf("saving: %w", badRequest("Quiet hours are times like 22:00.")), 400, "Quiet hours are times like 22:00."},
		{forbidden("Only the room owner can do this."), 403, "Only the room owner can do this."},
		{errors.New("sql: no rows in result set"), 404, "This no longer exists. Reload the page."},
		{errors.New("database is locked (5) (SQLITE_BUSY)"), 500, "Something went wrong while processing your request."},
		{errors.New("constraint failed: UNIQUE constraint failed: room_members.user"), 500, "Something went wrong while processing your request."},
	} {
		if status, message := answer(c.err); status != c.status || message != c.message {
			t.Errorf("%v: %d %q, want %d %q", c.err, status, message, c.status, c.message)
		}
	}
	// The validations' own words stay 400.
	if _, err := checkNotifications(notificationSettings{}); apiStatus(err) != 400 {
		t.Errorf("a validation's message: %v (%d)", err, apiStatus(err))
	}
}
