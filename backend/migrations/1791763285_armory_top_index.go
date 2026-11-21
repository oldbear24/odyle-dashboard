package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// The armory's top players (backend/odyle/ranks.go, scout.go): each class's strongest
// characters, read in the order of the top players page, with when their gear was read and
// when they were checked, from the index alone. The row's later columns come after its build,
// which a lookup would read through for every character.
func init() {
	register("1791763285_armory_top_index.go", armoryTopIndexUp, armoryTopIndexDown)
}

func armoryTopIndexUp(app core.App) error {
	ranks, err := app.FindCollectionByNameOrId("armory_ranks")
	if err != nil {
		return err
	}
	ranks.AddIndex("idx_armory_ranks_top", false, "`class`, `combatPower` DESC, `id`, `builtAt`, `checkedAt`", "`hidden` = FALSE")
	return app.Save(ranks)
}

func armoryTopIndexDown(app core.App) error {
	ranks, err := app.FindCollectionByNameOrId("armory_ranks")
	if err != nil {
		return err
	}
	ranks.RemoveIndex("idx_armory_ranks_top")
	return app.Save(ranks)
}
