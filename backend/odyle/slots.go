package odyle

import (
	"crypto/rand"
	"encoding/json"
	"math/big"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The Odyle slot machine (#107), an easter egg of the dashboard (the logo clicked seven times
// opens #/slots). Every account has free spins each day (slotRules.DailySpins, 3 unless a
// superuser sets another number; unused ones do not carry over), and playing earns more: by
// default one a day for each character the reader read that day (the game's daily reset), granted
// by the first accepted reading of the day; a first visit gives three welcome spins. A spin wins with a small chance (slotWinChance), rolled on the
// server: then a cosmetic item for the account, a name colour, an avatar frame or a badge, common
// to legendary. A duplicate gives a shard, and three shards give a spin back. Equipped items show next to the account's name in
// its rooms. Cosmetic only: nothing touches Odyle, characters or parties, and nothing is bought.

type cosmetic struct {
	Id     string `json:"id"`
	Kind   string `json:"kind"`   // color, frame or badge
	Rarity string `json:"rarity"` // common, rare, epic or legendary
	Name   string `json:"name"`
	Value  string `json:"value"` // a CSS colour or gradient, a frame style, or the badge's emoji
}

var cosmetics = []cosmetic{
	{"color-mint", "color", "common", "Mint", "#b5f2cd"},
	{"color-sky", "color", "common", "Sky", "#9fd3ff"},
	{"color-sand", "color", "common", "Sand", "#e8d8a8"},
	{"color-rose", "color", "common", "Rose", "#f2b5c4"},
	{"color-ember", "color", "rare", "Ember", "#ff9a5c"},
	{"color-violet", "color", "rare", "Violet", "#c3a6ff"},
	{"color-aqua", "color", "rare", "Aqua", "#5ee0d8"},
	{"color-gold", "color", "epic", "Gold", "#f3c94a"},
	{"color-crimson", "color", "epic", "Crimson", "#ff6b78"},
	{"color-aurora", "color", "legendary", "Aurora", "linear-gradient(90deg,#5ee0b0,#9fd3ff,#c3a6ff,#f2b5c4)"},
	{"color-lilac", "color", "common", "Lilac", "#d8c2f0"},
	{"color-peach", "color", "common", "Peach", "#ffc9a3"},
	{"color-lime", "color", "rare", "Lime", "#b8f25e"},
	{"color-coral", "color", "rare", "Coral", "#ff8f8f"},
	{"color-sunset", "color", "epic", "Sunset", "linear-gradient(90deg,#ff9a5c,#ff6b78,#c3a6ff)"},
	{"color-ocean", "color", "epic", "Ocean", "linear-gradient(90deg,#5ee0d8,#4f8fff)"},
	{"color-glow", "color", "legendary", "Odyle glow", "linear-gradient(90deg,#b5f2cd,#f3c94a,#5ee0b0)"},
	{"color-prism", "color", "legendary", "Prism", "linear-gradient(90deg,#ff6b78,#f3c94a,#b8f25e,#5ee0d8,#c3a6ff)"},
	{"frame-moss", "frame", "common", "Moss", "moss"},
	{"frame-stone", "frame", "common", "Stone", "stone"},
	{"frame-silver", "frame", "rare", "Silver", "silver"},
	{"frame-tide", "frame", "rare", "Tide", "tide"},
	{"frame-golden", "frame", "epic", "Golden", "golden"},
	{"frame-ember", "frame", "epic", "Ember", "ember"},
	{"frame-starfire", "frame", "legendary", "Starfire", "starfire"},
	{"frame-bark", "frame", "common", "Bark", "bark"},
	{"frame-frost", "frame", "rare", "Frost", "frost"},
	{"frame-blossom", "frame", "rare", "Blossom", "blossom"},
	{"frame-jade", "frame", "epic", "Jade", "jade"},
	{"frame-void", "frame", "epic", "Void", "void"},
	{"frame-eclipse", "frame", "legendary", "Eclipse", "eclipse"},
	{"badge-sprout", "badge", "common", "Sprout", "🌿"},
	{"badge-dice", "badge", "common", "Dice", "🎲"},
	{"badge-clover", "badge", "common", "Clover", "🍀"},
	{"badge-blades", "badge", "rare", "Blades", "⚔️"},
	{"badge-moon", "badge", "rare", "Moon", "🌙"},
	{"badge-shield", "badge", "rare", "Shield", "🛡️"},
	{"badge-dragon", "badge", "epic", "Dragon", "🐉"},
	{"badge-flame", "badge", "epic", "Flame", "🔥"},
	{"badge-crown", "badge", "legendary", "Crown", "👑"},
	{"badge-gem", "badge", "legendary", "Odyle gem", "💎"},
	{"badge-mushroom", "badge", "common", "Mushroom", "🍄"},
	{"badge-paw", "badge", "common", "Paw", "🐾"},
	{"badge-tea", "badge", "common", "Tea", "☕"},
	{"badge-bow", "badge", "rare", "Bow", "🏹"},
	{"badge-potion", "badge", "rare", "Potion", "🧪"},
	{"badge-owl", "badge", "rare", "Owl", "🦉"},
	{"badge-lightning", "badge", "epic", "Lightning", "⚡"},
	{"badge-skull", "badge", "epic", "Skull", "💀"},
	{"badge-unicorn", "badge", "epic", "Unicorn", "🦄"},
	{"badge-comet", "badge", "legendary", "Comet", "☄️"},
	{"badge-trophy", "badge", "legendary", "Trophy", "🏆"},
}

// slotWinChance is the chance a spin wins anything, in hundredths; slotOdds split the wins by
// rarity, in hundredths.
const slotWinChance = 15

// slotOdds are the chances of each rarity among the wins, in hundredths.
var slotOdds = []struct {
	rarity string
	weight int64
}{{"common", 60}, {"rare", 27}, {"epic", 10}, {"legendary", 3}}

const welcomeSpins, shardsForSpin = 3, 3

func cosmeticById(id string) (cosmetic, bool) {
	for _, c := range cosmetics {
		if c.Id == id {
			return c, true
		}
	}
	return cosmetic{}, false
}

// wardrobe is what an account keeps (users.cosmetics, hidden from every answer but these).
type wardrobe struct {
	Owned    []string          `json:"owned"`
	Equipped map[string]string `json:"equipped"`
	Shards   int64             `json:"shards"`
	Started  bool              `json:"started"`
	// The daily period of the free spins and how many of them are left in it. They are kept apart
	// from users.spins (earned spins, which carry over) and spent first.
	Day   string `json:"day"`
	Daily int64  `json:"daily"`
}

// refill gives the free spins of a new daily period, and takes back any above a lowered allowance.
// It answers whether the wardrobe changed.
func (w *wardrobe) refill(app core.App, at time.Time) bool {
	rules := readSettings(app)
	if day := spinDay(at, rules.DailyResetHour); w.Day != day {
		w.Day, w.Daily = day, rules.Slots.DailySpins
		return true
	}
	if w.Daily > rules.Slots.DailySpins {
		w.Daily = rules.Slots.DailySpins
		return true
	}
	return false
}

func wardrobeOf(user *core.Record) wardrobe {
	w := wardrobe{}
	_ = json.Unmarshal([]byte(user.GetString("cosmetics")), &w)
	if w.Owned == nil {
		w.Owned = []string{}
	}
	if w.Equipped == nil {
		w.Equipped = map[string]string{}
	}
	return w
}

// look is what rooms see of an account's equipped items: resolved values, so clients need no catalog.
func (w wardrobe) look() map[string]string {
	out := map[string]string{}
	for _, kind := range []string{"color", "frame", "badge"} {
		if c, ok := cosmeticById(w.Equipped[kind]); ok && c.Kind == kind && contains(w.Owned, c.Id) {
			out[kind] = c.Value
		}
	}
	return out
}

// looksOf are the looks of accounts by id, for room snapshots.
func looksOf(app core.App, ids []string) (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	users, err := app.FindRecordsByIds("users", ids)
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		if look := wardrobeOf(u).look(); len(look) > 0 {
			out[u.Id] = look
		}
	}
	return out, nil
}

// spinDay is the daily period a moment belongs to (the game's daily reset, UTC), as a date.
func spinDay(at time.Time, resetHour int64) string {
	at = at.UTC()
	start := time.Date(at.Year(), at.Month(), at.Day(), int(resetHour), 0, 0, 0, time.UTC)
	if start.After(at) {
		start = start.Add(-24 * time.Hour)
	}
	return start.Format("2006-01-02")
}

// grantDailySpin gives the character's account its spins (slotRules.PerCharacter) for the first
// accepted reading of the character in a daily period. Single-field updates: the day is claimed
// first, so a character earns them once a day however many readings come.
func grantDailySpin(app core.App, c *Character, at time.Time) error {
	rules := readSettings(app)
	day := spinDay(at, rules.DailyResetHour)
	if rules.Slots.PerCharacter < 1 || c.GetString("spinDay") == day {
		return nil
	}
	claimed, err := app.DB().NewQuery("UPDATE characters SET spinDay = {:day} WHERE id = {:id} AND spinDay != {:day}").Bind(dbx.Params{"day": day, "id": c.Id}).Execute()
	if err != nil {
		return err
	}
	if rows, _ := claimed.RowsAffected(); rows == 0 {
		return nil
	}
	_, err = app.DB().NewQuery("UPDATE users SET spins = spins + {:spins} WHERE id = {:user}").Bind(dbx.Params{"spins": rules.Slots.PerCharacter, "user": c.User()}).Execute()
	return err
}

// slotAnswer counts every spin the account can use in `spins`: the free ones left today (`daily`,
// of `dailySpins`) and the earned ones.
func slotAnswer(app core.App, user *core.Record, w wardrobe, extra map[string]any) map[string]any {
	rules := readSettings(app).Slots
	out := map[string]any{"spins": int64(user.GetInt("spins")) + w.Daily, "daily": w.Daily, "dailySpins": rules.DailySpins, "perCharacter": rules.PerCharacter, "shards": w.Shards, "shardsForSpin": shardsForSpin, "winChance": slotWinChance, "owned": w.Owned, "equipped": w.Equipped, "catalog": cosmetics}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

// fresh is the account as it is inside the transaction: writes go one after another there, so two
// spins at once cannot spend the same spin.
func fresh(app core.App, user *core.Record) (*core.Record, error) {
	return app.FindRecordById("users", user.Id)
}

// POST /api/odyle/slots: the account's spins, shards and collection with the catalog; the first
// visit gives the welcome spins, the first of a daily period the free spins.
func slots(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, _ body, _ *[]string) (any, error) {
		user, err := fresh(app, user)
		if err != nil {
			return nil, err
		}
		w := wardrobeOf(user)
		changed := w.refill(app, time.Now())
		if !w.Started {
			w.Started, changed = true, true
			user.Set("spins", user.GetInt("spins")+welcomeSpins)
		}
		if changed {
			user.Set("cosmetics", w)
			if err := app.Save(user); err != nil {
				return nil, err
			}
		}
		return slotAnswer(app, user, w, nil), nil
	})
}

func roll(limit int64) int64 {
	n, err := rand.Int(rand.Reader, big.NewInt(limit))
	if err != nil {
		return 0
	}
	return n.Int64()
}

// POST /api/odyle/slot-spin: one spin, rolled here: a rarity by slotOdds, then one of its items.
// A free spin of the day goes first, then an earned one.
func slotSpin(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, _ body, _ *[]string) (any, error) {
		user, err := fresh(app, user)
		if err != nil {
			return nil, err
		}
		w := wardrobeOf(user)
		w.refill(app, time.Now())
		spins := user.GetInt("spins")
		if w.Daily > 0 {
			w.Daily--
		} else if spins > 0 {
			spins--
		} else {
			return nil, badRequest("No spins left. New ones come with the daily reset.")
		}
		w.Started = true
		// Most spins win nothing (#107, the owner: a small chance to win).
		if roll(100) >= slotWinChance {
			user.Set("spins", spins)
			user.Set("cosmetics", w)
			if err := app.Save(user); err != nil {
				return nil, err
			}
			return slotAnswer(app, user, w, map[string]any{"won": nil, "duplicate": false, "lost": true}), nil
		}
		pick, rarity := roll(100), "common"
		for _, o := range slotOdds {
			if pick < o.weight {
				rarity = o.rarity
				break
			}
			pick -= o.weight
		}
		pool := []cosmetic{}
		for _, c := range cosmetics {
			if c.Rarity == rarity {
				pool = append(pool, c)
			}
		}
		won := pool[roll(int64(len(pool)))]
		duplicate := contains(w.Owned, won.Id)
		if duplicate {
			w.Shards++
			if w.Shards >= shardsForSpin {
				w.Shards -= shardsForSpin
				spins++
			}
		} else {
			w.Owned = append(w.Owned, won.Id)
		}
		user.Set("spins", spins)
		user.Set("cosmetics", w)
		if err := app.Save(user); err != nil {
			return nil, err
		}
		return slotAnswer(app, user, w, map[string]any{"won": won, "duplicate": duplicate, "lost": false}), nil
	})
}

// POST /api/odyle/slot-equip { kind, id }: wears an owned item of that kind, or nothing with an empty id.
func slotEquip(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		user, err := fresh(app, user)
		if err != nil {
			return nil, err
		}
		kind, id := b.str("kind"), b.str("id")
		if kind != "color" && kind != "frame" && kind != "badge" {
			return nil, badRequest("Choose a colour, a frame or a badge.")
		}
		w := wardrobeOf(user)
		w.refill(app, time.Now())
		if id == "" {
			delete(w.Equipped, kind)
		} else if c, ok := cosmeticById(id); !ok || c.Kind != kind || !contains(w.Owned, id) {
			return nil, badRequest("That item is not in your collection.")
		} else {
			w.Equipped[kind] = id
		}
		user.Set("cosmetics", w)
		if err := app.Save(user); err != nil {
			return nil, err
		}
		// The account's rooms show the new look.
		rooms, err := roomsFor(app, user.Id)
		if err != nil {
			return nil, err
		}
		*affected = append(*affected, rooms...)
		return slotAnswer(app, user, w, nil), nil
	})
}
