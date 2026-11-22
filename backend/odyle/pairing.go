package odyle

import (
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/security"
)

// Superusers can pause new pairings (Server controls); paired PCs keep signing in.
func pairingOpen(app core.App) error {
	if readSettings(app).PairingPaused {
		return badRequest("Pairing new PCs is paused for now. Try again later.")
	}
	return nil
}

func desktopCode(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, _ body, _ *[]string) (any, error) {
		if err := pairingOpen(app); err != nil {
			return nil, err
		}
		old, err := list(app, "desktop_codes", "user = {:user}", dbx.Params{"user": user.Id})
		if err != nil {
			return nil, err
		}
		for _, r := range old {
			if err := app.Delete(r); err != nil {
				return nil, err
			}
		}
		code := security.RandomStringWithAlphabet(16, codeAlphabet)
		record, err := newRecord(app, "desktop_codes")
		if err != nil {
			return nil, err
		}
		record.Set("user", user.Id)
		record.Set("digest", security.SHA256(code))
		record.Set("expiresAt", expiry(300))
		if err := app.Save(record); err != nil {
			return nil, err
		}
		return map[string]any{"code": code, "expiresAt": record.GetString("expiresAt")}, nil
	})
}

// newDevice is a paired Windows app's lasting credential. Only its digest is stored;
// the app keeps the key (DPAPI) and trades it for account tokens with desktopSignIn. An
// account keeps its most recently used devices, so stale pairings of reinstalled PCs
// drop off.
func newDevice(app core.App, userId, name string) (string, *Device, error) {
	devices, err := devicesOf(app, userId, 500)
	if err != nil {
		return "", nil, err
	}
	if len(devices) >= limits.DesktopDevices {
		for _, old := range devices[limits.DesktopDevices-1:] {
			if err := dropDevice(app, old); err != nil {
				return "", nil, err
			}
		}
	}
	key := security.RandomString(48)
	device, err := newAs[Device](app, "desktop_devices")
	if err != nil {
		return "", nil, err
	}
	device.Set("user", userId)
	device.Set("digest", security.SHA256(key))
	device.SetName(name)
	device.Used()
	return key, device, app.Save(device)
}

// devicesOf is an account's paired PCs, the most recently used first (up to limit, 0 for all).
func devicesOf(app core.App, userId string, limit int) ([]*Device, error) {
	found, err := app.FindRecordsByFilter("desktop_devices", "user = {:user}", "-lastUsedAt,-created", limit, 0, dbx.Params{"user": userId})
	return views[Device](found), err
}

// dropDevice ends a pairing: its key stops working and its reader sessions end (their
// readings turn stale), so the app notices at its next heartbeat and asks for a new
// connection link.
func dropDevice(app core.App, device *Device) error {
	if _, err := endSessions(app, "device = {:device}", dbx.Params{"device": device.Id}); err != nil {
		return err
	}
	return app.Delete(device)
}

func deviceKey(b body) (string, error) { return text(b["deviceKey"], "Device key", 100) }

func findDevice(app core.App, key string) *Device {
	device, err := firstAs[Device](app, "desktop_devices", "digest", security.SHA256(key))
	if err != nil {
		return nil
	}
	return device
}

// deviceName is the Windows computer name the app sends with pairing and sign-in;
// optional, for the list of paired PCs. Anything that is not a usable name is left
// out, never refused.
func deviceName(value any) string {
	if s, ok := value.(string); ok && trim(s) != "" {
		return cut(collapse(trim(s)), 40)
	}
	return ""
}

func pair(e *core.RequestEvent) error {
	return run(e, func() error {
		if err := pairingOpen(e.App); err != nil {
			return err
		}
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		typed, err := text(b["code"], "Pairing code", 24)
		if err != nil {
			return err
		}
		var result map[string]any
		if err := e.App.RunInTransaction(func(app core.App) error {
			code, err := firstAs[PairingCode](app, "desktop_codes", "digest", security.SHA256(normalizeCode(typed)))
			if err != nil || !code.ExpiresAt().After(time.Now()) {
				return badRequest("Pairing code is invalid or expired.")
			}
			user, err := app.FindRecordById("users", code.User())
			if err != nil {
				return err
			}
			if err := app.Delete(code); err != nil {
				return err
			}
			key, device, err := newDevice(app, user.Id, deviceName(b["name"]))
			if err != nil {
				return err
			}
			token, err := appToken(user, device)
			if err != nil {
				return err
			}
			achieved(app, user.Id, nil, true)
			result = map[string]any{"token": token, "record": user, "deviceKey": key}
			return nil
		}); err != nil {
			return err
		}
		return e.JSON(200, result)
	})
}

// desktopSignIn is public: a fresh account token for a paired app. An unknown key (the
// app disconnected, the account signed out everywhere or was deleted) is 401, and the
// app pairs again.
func desktopSignIn(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		key, err := deviceKey(b)
		if err != nil {
			return err
		}
		device, name := findDevice(e.App, key), deviceName(b["name"])
		if device == nil {
			return unauthorized("This PC is no longer paired with an account.")
		}
		user, err := e.App.FindRecordById("users", device.User())
		if err != nil {
			return err
		}
		device.Used()
		if name != "" {
			device.SetName(name)
		}
		if err := e.App.Save(device); err != nil {
			return err
		}
		token, err := appToken(user, device)
		if err != nil {
			return err
		}
		return e.JSON(200, map[string]any{"token": token, "record": user})
	})
}

// unpair is public: the app's Disconnect forgets its key on the server too. Unknown
// keys are fine.
func unpair(e *core.RequestEvent) error {
	return run(e, func() error {
		b, err := requestBody(e)
		if err != nil {
			return err
		}
		key, err := deviceKey(b)
		if err != nil {
			return err
		}
		if device := findDevice(e.App, key); device != nil {
			roomIds, err := roomsFor(e.App, device.User())
			if err != nil {
				return err
			}
			if err := e.App.RunInTransaction(func(app core.App) error {
				current, err := findAs[Device](app, "desktop_devices", device.Id)
				if err != nil {
					return err
				}
				return dropDevice(app, current)
			}); err != nil {
				return err
			}
			notify(e.App, roomIds)
		}
		return e.JSON(200, map[string]any{"success": true})
	})
}

// forgetDevice removes one paired PC under Account & data, for example a lost or sold
// one; the other browsers and PCs stay signed in.
func forgetDevice(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		device, err := findAs[Device](app, "desktop_devices", b.str("deviceId"))
		if err != nil {
			return nil, notFound("This PC is no longer paired.")
		}
		if device.User() != user.Id {
			return nil, forbidden("This PC is paired with another account.")
		}
		if err := dropDevice(app, device); err != nil {
			return nil, err
		}
		roomIds, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, roomIds...)
		return nil, nil
	})
}
