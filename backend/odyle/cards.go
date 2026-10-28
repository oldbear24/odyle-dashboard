package odyle

import (
	"slices"
	"strconv"
	"strings"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Player cards: an armory profile as a trading card that turns in 3D, on a page of its own
// (/armory/<region>/<server id>/<character id>/card, src/card.js). What the card shows comes
// from PLAYNC like the rest of the armory (R1); only its look is chosen. The player whose
// Odyle app read the character picks one of three designs: the daily class lookup ties
// their account's character to its profile (officialId, officialRegion, officialServerId,
// classes.go). Players who say they have the game's membership (membership.go) may add a
// holo finish. The choice is kept on the account's character (cardDesign, cardFinish), and a
// holo finish shows only while its owner's answer is yes. A card nobody chose a design for
// has none (""): the dashboard draws it after the character's race.

var (
	cardDesigns  = []string{"elysea", "asmodae", "abyss"}
	cardFinishes = []string{"", "prism", "starfall", "etched"}
)

// armoryCard is a profile's card as a reader sees it.
type armoryCard struct {
	Design string `json:"design"` // "" until one is chosen
	Finish string `json:"finish"` // "" for plain
	Mine   bool   `json:"mine"`   // the reader's account read this character, so may change the card
	Holo   bool   `json:"holo"`   // and may choose a holo finish
}

// cardOwners are the characters of Odyle accounts that the daily lookup found as this profile.
func cardOwners(app core.App, region string, serverId int, characterId string) ([]*Character, error) {
	return charactersWhere(app, "officialId = {:id} && officialRegion = {:region} && officialServerId = {:server}", dbx.Params{"id": characterId, "region": region, "server": serverId})
}

// cardOf is the card of a profile for reader (nil when signed out): the design its owner
// chose (the reader's own first, else the one chosen last), with the holo finish while its
// owner has the membership.
func cardOf(app core.App, region string, serverId int, characterId string, reader *core.Record) (armoryCard, error) {
	card := armoryCard{}
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
		if finish := c.GetString("cardFinish"); finish != "" && slices.Contains(cardFinishes, finish) {
			if owner, err := app.FindRecordById("users", c.User()); err == nil && owner.GetString("membership") == "yes" {
				card.Finish = finish
			}
		}
		break
	}
	return card, nil
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
			if c.GetString("cardDesign") == design && c.GetString("cardFinish") == finish {
				continue
			}
			c.Set("cardDesign", design)
			c.Set("cardFinish", finish)
			if err := app.Save(c); err != nil {
				return nil, err
			}
		}
		return cardOf(app, region, serverId, characterId, account)
	})
}
