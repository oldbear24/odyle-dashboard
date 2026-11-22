package odyle

import (
	"regexp"
	"slices"
	"strings"
)

// TH.GL's AION 2 maps as its map list (aion2.th.gl/maps) names them on 2026-10-27, in its order
// (data/thgl-maps.json): the names its map pages and embeds take (aion2.th.gl/embed/maps/<name>,
// www.th.gl/developers). A name that lists several places is one map they share: "Herb Cave /
// Valka's Nest (+3)" shows Herb Cave, Valka's Nest and three more. Game settings offer these maps
// and link them by the places they show (linkMap); a superuser still gives any other TH.GL map by
// its name, so a map TH.GL adds later works before this list has it.
var thglMaps = embeddedJSON[[]string]("data/thgl-maps.json")

// A count of places a TH.GL map's name leaves out, and a difficulty naming one version of a place.
var thglMore, thglLevel = regexp.MustCompile(` \(\+\d+\)$`), regexp.MustCompile(` \((?:Easy|Normal|Hard)\)$`)

// thglPlaces are the places a TH.GL map's name lists, each also without its difficulty:
// "Nightmare Altar (Easy) / Nightmare Altar (Normal) (+4)" lists Nightmare Altar (Easy),
// Nightmare Altar (Normal) and Nightmare Altar.
func thglPlaces(name string) []string {
	out := []string{}
	for _, part := range strings.Split(thglMore.ReplaceAllString(name, ""), " / ") {
		for _, place := range []string{part, thglLevel.ReplaceAllString(part, "")} {
			if !slices.Contains(out, place) {
				out = append(out, place)
			}
		}
	}
	return out
}

// placeKey matches names regardless of case, spacing and curly apostrophes.
func placeKey(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.ReplaceAll(s, "’", "'")), " "))
}

// The TH.GL maps by name, and by each place they list; a place two maps list links neither.
var thglByName, thglByPlace = func() (map[string]string, map[string]string) {
	names, places, listed := map[string]string{}, map[string]string{}, map[string]int{}
	for _, name := range thglMaps {
		names[placeKey(name)] = name
		for _, place := range thglPlaces(name) {
			places[placeKey(place)] = name
			listed[placeKey(place)]++
		}
	}
	for place, n := range listed {
		if n > 1 {
			delete(places, place)
		}
	}
	return names, places
}()

// thglMapOf is the TH.GL map of the place a map is named after: the TH.GL map of that name, or
// the only one listing that place; "" for none.
func thglMapOf(name string) string {
	if m, ok := thglByName[placeKey(name)]; ok {
		return m
	}
	return thglByPlace[placeKey(name)]
}

// linkMap fills in what a superuser left out of a map: a map named after a place TH.GL lists
// links its TH.GL map, and a map linked to a TH.GL map of one place takes that place's name. A
// TH.GL map of the list keeps TH.GL's spelling.
func linkMap(m gameMap) gameMap {
	if known, ok := thglByName[placeKey(m.Thgl)]; ok && m.Thgl != "" {
		m.Thgl = known
		if places := thglPlaces(known); m.Name == "" && len(places) == 1 {
			m.Name = places[0]
		}
	}
	if m.Thgl == "" && m.Name != "" {
		m.Thgl = thglMapOf(m.Name)
	}
	return m
}

// thglCatalog is the list for Game settings: each TH.GL map with the places it lists.
func thglCatalog() []any {
	out := make([]any, len(thglMaps))
	for i, name := range thglMaps {
		out[i] = map[string]any{"name": name, "places": thglPlaces(name)}
	}
	return out
}
