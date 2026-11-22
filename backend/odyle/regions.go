package odyle

// gameRegion is one AION 2 Global region by every name Odyle needs for it: how characters are
// saved (Odyle), its digit in a server id (race * 1000 + digit * 100 + place, see servers.go),
// PLAYNC's search region code and its name in page titles.
type gameRegion struct {
	odyle string
	digit int
	code  string
	title string
	// alsoIn is a second Odyle region whose servers a character of this one may be on: NA
	// characters were all saved as NA (East) before NA-West was told apart (odyle-windows#4).
	alsoIn string
}

// gameRegions are the Global regions in the order the armory's server list shows them.
// GLOBAL_NA is NA-East (and NA characters saved before the split), GLOBAL_NAW NA-West.
var gameRegions = []gameRegion{
	{odyle: "GLOBAL_NA", digit: 1, code: "nae", title: "North America East", alsoIn: "GLOBAL_NAW"},
	{odyle: "GLOBAL_NAW", digit: 2, code: "naw", title: "North America West"},
	{odyle: "GLOBAL_EU", digit: 3, code: "eu", title: "Europe"},
	{odyle: "GLOBAL_SA", digit: 4, code: "la", title: "South America"},
	{odyle: "GLOBAL_ASIA", digit: 5, code: "as", title: "Asia"},
}

// regionWhere is the first region the test accepts, or the zero region (digit 0, no names).
func regionWhere(test func(gameRegion) bool) gameRegion {
	for _, r := range gameRegions {
		if test(r) {
			return r
		}
	}
	return gameRegion{}
}

// regionNamed is the region characters are saved under as name (GLOBAL_EU).
func regionNamed(name string) gameRegion {
	return regionWhere(func(r gameRegion) bool { return r.odyle == name })
}

// regionOfDigit is the region of a server id's region digit.
func regionOfDigit(digit int) gameRegion {
	return regionWhere(func(r gameRegion) bool { return r.digit == digit })
}

// regionOfCode is the region of a PLAYNC search region code (eu).
func regionOfCode(code string) gameRegion {
	return regionWhere(func(r gameRegion) bool { return r.code == code })
}

// knownRegion reports whether characters can be saved under the region.
func knownRegion(name string) bool { return regionNamed(name).digit != 0 }

// searchRegions are the PLAYNC search regions a character saved under an Odyle region may be
// in, in the order to try them: GLOBAL_NA tries East, then West; none for an unknown region.
func searchRegions(name string) []gameRegion {
	r := regionNamed(name)
	if r.digit == 0 {
		return nil
	}
	out := []gameRegion{r}
	if r.alsoIn != "" {
		out = append(out, regionNamed(r.alsoIn))
	}
	return out
}
