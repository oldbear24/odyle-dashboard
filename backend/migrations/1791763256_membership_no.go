package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The membership answer starts at "no" (backend/odyle/membership.go). Accounts that never
// answered get "no", except those whose readings already showed the membership (a character's
// natural pool held more than the smallest cap), which get "yes", so their clock stays as it
// was. Their characters carry the cap the answer settles, under the clock's caps saved under
// Game settings, else the defaults. Down keeps the answers: an open one can no longer be told
// from a "no".
func init() {
	register("1791763256_membership_no.go", membershipNo, func(core.App) error { return nil })
}

func membershipNo(app core.App) error {
	least, most := int64(560), int64(840)
	if s, err := app.FindFirstRecordByFilter("odyle_settings", `id != ""`); err == nil {
		var clock struct {
			Caps []int64 `json:"caps"`
		}
		if json.Unmarshal([]byte(s.GetString("clock")), &clock) == nil && len(clock.Caps) > 0 {
			least, most = clock.Caps[0], clock.Caps[len(clock.Caps)-1]
		}
	}
	params := dbx.Params{"least": least, "most": most}
	if _, err := app.DB().NewQuery("UPDATE users SET membership = CASE WHEN EXISTS (SELECT 1 FROM characters WHERE characters.user = users.id AND characters.naturalMax > {:least}) THEN 'yes' ELSE 'no' END WHERE membership = ''").Bind(params).Execute(); err != nil {
		return err
	}
	_, err := app.DB().NewQuery("UPDATE characters SET answeredCap = CASE (SELECT membership FROM users WHERE users.id = characters.user) WHEN 'yes' THEN {:most} WHEN 'no' THEN {:least} ELSE 0 END").Bind(params).Execute()
	return err
}
