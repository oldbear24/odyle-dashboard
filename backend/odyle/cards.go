package odyle

import (
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Player cards: an armory profile as a trading card that turns in 3D, on a page of its own
// (/armory/<region>/<server id>/<character id>/card, src/card.js). What the card shows comes
// from PLAYNC like the rest of the armory (R1); only its look is chosen. The player whose
// Odyle app read the character picks one of the designs: the daily class lookup ties their
// account's character to its profile (officialId, officialRegion, officialServerId,
// classes.go). Players who say they have the game's membership (membership.go) may add a
// holo finish. The rest of the look are the card's options: the layout, the design of its
// back, which stats and which two skills it shows, and the line under the class (the title,
// the legion or none). Every option picks from what PLAYNC lists; nothing is typed in. The
// choice is kept on the account's character (cardDesign, cardFinish, cardOptions), and a holo
// finish shows only while its owner's answer is yes. A card nobody chose a design for has
// none (""): the dashboard draws it after the character's race.

var (
	cardDesigns  = []string{"elysea", "asmodae", "abyss", "balaur", "beluslan", "heiron"}
	cardFinishes = []string{"", "prism", "starfall", "etched"}
	cardLayouts  = []string{"classic", "full"}
	cardStats    = []string{"primary", "deity"}
	cardLines    = []string{"title", "legion", "none"}
)

// cardOptions are a card's look beyond its design and finish.
type cardOptions struct {
	Layout string   `json:"layout"` // classic, or full: the portrait across the whole card
	Back   string   `json:"back"`   // the back's design; "" for the front's
	Stats  string   `json:"stats"`  // primary or deity
	Line   string   `json:"line"`   // under the class: title, legion or none
	Skills []string `json:"skills"` // up to two skills to show; none for the strongest on the skill bar
}

func defaultCardOptions() cardOptions {
	return cardOptions{Layout: "classic", Stats: "primary", Line: "title", Skills: []string{}}
}

// known is o with anything not offered (any more) back at its default.
func (o cardOptions) known() cardOptions {
	d := defaultCardOptions()
	if slices.Contains(cardLayouts, o.Layout) {
		d.Layout = o.Layout
	}
	if slices.Contains(cardDesigns, o.Back) {
		d.Back = o.Back
	}
	if slices.Contains(cardStats, o.Stats) {
		d.Stats = o.Stats
	}
	if slices.Contains(cardLines, o.Line) {
		d.Line = o.Line
	}
	for _, s := range o.Skills {
		if s != "" && len(s) <= 80 && len(d.Skills) < 2 && !slices.Contains(d.Skills, s) {
			d.Skills = append(d.Skills, s)
		}
	}
	return d
}

// armoryCard is a profile's card as a reader sees it.
type armoryCard struct {
	Design  string      `json:"design"` // "" until one is chosen
	Finish  string      `json:"finish"` // "" for plain
	Options cardOptions `json:"options"`
	Mine    bool        `json:"mine"` // the reader's account read this character, so may change the card
	Holo    bool        `json:"holo"` // and may choose a holo finish
}

// cardOwners are the characters of Odyle accounts that the daily lookup found as this profile.
func cardOwners(app core.App, region string, serverId int, characterId string) ([]*Character, error) {
	return charactersWhere(app, "officialId = {:id} && officialRegion = {:region} && officialServerId = {:server}", dbx.Params{"id": characterId, "region": region, "server": serverId})
}

// cardOf is the card of a profile for reader (nil when signed out): the look its owner chose
// (the reader's own first, else the one chosen last), with the holo finish while its owner
// has the membership.
func cardOf(app core.App, region string, serverId int, characterId string, reader *core.Record) (armoryCard, error) {
	card := armoryCard{Options: defaultCardOptions()}
	owners, err := cardOwners(app, region, serverId, characterId)
	if err != nil || len(owners) == 0 {
		return card, err
	}
	slices.SortStableFunc(owners, func(a, b *Character) int {
		mine := func(c *Character) bool { return reader != nil && c.User() == reader.Id }
		if mine(a) != mine(b) {
			return boolOrder(mine(b)) - boolOrder(mine(a))
		}
		return strings.Compare(b.GetString("updated"), a.GetString("updated"))
	})
	for _, c := range owners {
		if reader != nil && c.User() == reader.Id {
			card.Mine = true
			card.Holo = reader.GetString("membership") == "yes"
		}
	}
	for _, c := range owners {
		design := c.GetString("cardDesign")
		if !slices.Contains(cardDesigns, design) {
			continue
		}
		card.Design = design
		var options cardOptions
		if err := c.UnmarshalJSONField("cardOptions", &options); err == nil {
			card.Options = options.known()
		}
		if finish := c.GetString("cardFinish"); finish != "" && slices.Contains(cardFinishes, finish) {
			if owner, err := app.FindRecordById("users", c.User()); err == nil && owner.GetString("membership") == "yes" {
				card.Finish = finish
			}
		}
		break
	}
	return card, nil
}

var errCardOptions = errors.New("Choose the card's options from those offered.")

// readCardOptions are the options a request asks for (missing ones at their defaults),
// checked against what is offered and the profile the armory keeps: the skills must be ones
// the character learned.
func readCardOptions(app core.App, raw any, serverId int, characterId string) (cardOptions, error) {
	if raw == nil {
		return defaultCardOptions(), nil
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return cardOptions{}, errCardOptions
	}
	asked := defaultCardOptions()
	if err := json.Unmarshal(encoded, &asked); err != nil || len(asked.Skills) > 2 {
		return cardOptions{}, errCardOptions
	}
	options := asked.known()
	if options.Layout != asked.Layout || options.Back != asked.Back || options.Stats != asked.Stats || options.Line != asked.Line || len(options.Skills) != len(asked.Skills) {
		return cardOptions{}, errCardOptions
	}
	if len(options.Skills) > 0 {
		record, err := keptProfile(app, serverId, characterId)
		if err != nil {
			return cardOptions{}, err
		}
		var p armoryProfile
		if record == nil || record.UnmarshalJSONField("profile", &p) != nil {
			return cardOptions{}, errCardOptions
		}
		for _, name := range options.Skills {
			if !slices.ContainsFunc(p.Skills, func(s armorySkill) bool { return s.Name == name && s.Acquired }) {
				return cardOptions{}, errCardOptions
			}
		}
	}
	return options, nil
}

// cardChoice saves the look of a profile's card (POST /api/odyle/card) for the account whose
// characters the lookup found as that profile.
func cardChoice(e *core.RequestEvent) error {
	return mutate(e, func(app core.App, user *core.Record, b body, affected *[]string) (any, error) {
		region, characterId := b.str("region"), b.str("characterId")
		serverId, _ := strconv.Atoi(b.str("serverId"))
		design, _ := b.text("design")
		finish, _ := b.text("finish")
		if armoryServer(region, serverId) == "" || !armoryIds.MatchString(characterId) {
			return nil, notFound("This character is not in the armory.")
		}
		if !slices.Contains(cardDesigns, design) || !slices.Contains(cardFinishes, finish) {
			return nil, badRequest("Choose one of the card designs and finishes.")
		}
		options, err := readCardOptions(app, b["options"], serverId, characterId)
		if errors.Is(err, errCardOptions) {
			return nil, badRequest("Choose the card's options from those offered.")
		} else if err != nil {
			return nil, err
		}
		owners, err := cardOwners(app, region, serverId, characterId)
		if err != nil {
			return nil, err
		}
		owners = slices.DeleteFunc(owners, func(c *Character) bool { return c.User() != user.Id })
		if len(owners) == 0 {
			return nil, forbidden("Only the player whose Odyle app read this character can change its card.")
		}
		account, err := app.FindRecordById("users", user.Id)
		if err != nil {
			return nil, err
		}
		if finish != "" && account.GetString("membership") != "yes" {
			return nil, forbidden("Holo finishes are for players with the membership.")
		}
		for _, c := range owners {
			c.Set("cardDesign", design)
			c.Set("cardFinish", finish)
			c.Set("cardOptions", options)
			if err := app.Save(c); err != nil {
				return nil, err
			}
		}
		return cardOf(app, region, serverId, characterId, account)
	})
}
