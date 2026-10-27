package migrations

import "ganigeorgiev.com/pocketbase/pocketbase/core"

// NA-East and NA-West (odyle-windows#4): the two North American regions have servers of the same
// names (Siel 1101 in the East, Siel 1201 in the West), so characters are kept apart as GLOBAL_NA
// (East, and NA characters saved before the split) and GLOBAL_NAW (West). Characters PLAYNC's
// search already found in NA-West move there now; the daily lookup moves the others when it finds
// them there (classes.go setOfficial). One the account also has under NA-West stays.
func init() {
	register("1791763245_na_west.go", func(app core.App) error {
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		region, _ := characters.Fields.GetByName("region").(*core.SelectField)
		if region == nil {
			return nil
		}
		region.Values = append(region.Values, "GLOBAL_NAW")
		if err := app.Save(characters); err != nil {
			return err
		}
		_, err = app.DB().NewQuery(`UPDATE characters SET region = 'GLOBAL_NAW' WHERE region = 'GLOBAL_NA' AND officialRegion = 'naw'
			AND NOT EXISTS (SELECT 1 FROM characters AS west WHERE west.user = characters.user AND west.region = 'GLOBAL_NAW' AND west.server = characters.server AND west.characterName = characters.characterName)`).Execute()
		return err
	}, func(app core.App) error {
		if _, err := app.DB().NewQuery(`UPDATE characters SET region = 'GLOBAL_NA' WHERE region = 'GLOBAL_NAW'
			AND NOT EXISTS (SELECT 1 FROM characters AS east WHERE east.user = characters.user AND east.region = 'GLOBAL_NA' AND east.server = characters.server AND east.characterName = characters.characterName)`).Execute(); err != nil {
			return err
		}
		if _, err := app.DB().NewQuery(`DELETE FROM characters WHERE region = 'GLOBAL_NAW'`).Execute(); err != nil {
			return err
		}
		characters, err := app.FindCollectionByNameOrId("characters")
		if err != nil {
			return err
		}
		if region, _ := characters.Fields.GetByName("region").(*core.SelectField); region != nil {
			values := []string{}
			for _, v := range region.Values {
				if v != "GLOBAL_NAW" {
					values = append(values, v)
				}
			}
			region.Values = values
		}
		return app.Save(characters)
	})
}
