package odyle

import (
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
	"github.com/golang-jwt/jwt/v5"
)

// The account tokens of paired Windows apps name the PC they were given to (deviceClaim),
// so forgetting that PC under Account & data, the app's own Disconnect or Sign out
// everywhere cut it off at once: every request with such a token is checked against the
// PC's pairing (boundDevice), and its realtime connections close (closeDeviceClients).
// The token lasts a day and cannot be refreshed; the app trades its device key for a new
// one whenever the server answers 401 and once a day (desktopSignIn). Browsers keep the
// usual refreshable account tokens.
const deviceClaim = "odyleDevice"

var appTokenLifetime = 24 * time.Hour

// A pairing nobody signed in with for this long ends at the expiry job: a PC that was
// sold, lost or reinstalled stops holding a lasting key to the account. An app signs in at
// each start and once a day while it runs, so only a PC left off that long pairs again.
var deviceKeep = 180 * 24 * time.Hour

// appToken is the account token of the app paired as device.
func appToken(user *core.Record, device *Device) (string, error) {
	key := user.TokenKey() + user.Collection().AuthToken.Secret
	if key == "" {
		return "", core.ErrMissingSigningKey
	}
	return security.NewJWT(jwt.MapClaims{
		core.TokenClaimType:         core.TokenTypeAuth,
		core.TokenClaimId:           user.Id,
		core.TokenClaimCollectionId: user.Collection().Id,
		core.TokenClaimRefreshable:  false,
		deviceClaim:                 device.Id,
	}, key, appTokenLifetime)
}

// requestDevice is the PC named by the request's account token, or "" for a browser's
// token or none. PocketBase has verified the token by the time a route or hook asks.
func requestDevice(e *core.RequestEvent) string {
	token := e.Request.Header.Get("Authorization")
	if len(token) > 7 && strings.EqualFold(token[:7], "Bearer ") {
		token = token[7:]
	}
	if token == "" {
		return ""
	}
	claims, err := security.ParseUnverifiedJWT(token)
	if err != nil {
		return ""
	}
	id, _ := claims[deviceClaim].(string)
	return id
}

// boundDevice signs nobody in with an app's token once its PC's pairing has ended. It runs
// before PocketBase's check of unknown tokens, which then answers 401 (an app signs in with
// its device key, which fails too, and the pairing is over), and before staleTokenIgnored, so
// the public actions still answer: a forgotten PC can pair again with a new code.
var boundDevice = &hook.Handler[*core.RequestEvent]{
	Id:       "odyleBoundDevice",
	Priority: apis.DefaultRejectUnknownTokenMiddlewarePriority - 2,
	Func: func(e *core.RequestEvent) error {
		if e.Auth == nil || e.Auth.Collection().Name != "users" {
			return e.Next()
		}
		if id := requestDevice(e); id != "" {
			if device, err := findAs[Device](e.App, "desktop_devices", id); err != nil || device.User() != e.Auth.Id {
				e.Auth = nil
			}
		}
		return e.Next()
	},
}

// watchDevices notes on each realtime connection the PC whose token opened it and closes
// those connections when the PC's pairing ends, however it ends.
func watchDevices(app core.App) {
	app.OnRealtimeSubscribeRequest().BindFunc(func(e *core.RealtimeSubscribeRequestEvent) error {
		if id := requestDevice(e.RequestEvent); id != "" {
			e.Client.Set(deviceClaim, id)
		}
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("desktop_devices").BindFunc(func(e *core.RecordEvent) error {
		closeDeviceClients(e.App, e.Record.Id)
		return e.Next()
	})
}

// closeDeviceClients ends the realtime connections a PC opened.
func closeDeviceClients(app core.App, deviceId string) {
	for _, c := range app.SubscriptionsBroker().Clients() {
		if id, _ := c.Get(deviceClaim).(string); id == deviceId {
			c.Unset(apis.RealtimeClientAuthKey)
			c.Discard()
		}
	}
}

// dropUnusedDevices ends the pairings no app signed in with for deviceKeep, a batch per
// run like the other expiry work. Pairings from before sign-ins were noted count from
// their pairing.
func dropUnusedDevices(app core.App, at time.Time) (int, error) {
	found, err := app.FindRecordsByFilter("desktop_devices", "(lastUsedAt != '' && lastUsedAt < {:cutoff}) || (lastUsedAt = '' && created < {:cutoff})", "created", 500, 0, dbx.Params{"cutoff": stamp(at.Add(-deviceKeep))})
	if err != nil {
		return 0, err
	}
	for _, device := range views[Device](found) {
		if err := dropDevice(app, device); err != nil {
			return 0, err
		}
	}
	return len(found), nil
}
