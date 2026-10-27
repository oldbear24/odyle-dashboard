package odyle

import (
	"regexp"
	"slices"
	"strings"
)

// TH.GL's AION 2 maps as its map list (aion2.th.gl/maps) names them on 2026-10-27, in its order:
// the names its map pages and embeds take (aion2.th.gl/embed/maps/<name>, www.th.gl/developers).
// A name that lists several places is one map they share: "Herb Cave / Valka's Nest (+3)" shows
// Herb Cave, Valka's Nest and three more. Game settings offer these maps and link them by the
// places they show (linkMap); a superuser still gives any other TH.GL map by its name, so a map
// TH.GL adds later works before this list has it.
var thglMaps = []string{
	"Verteron",
	"Eltnen",
	"Poeta",
	"Altgard",
	"Morheim",
	"Ishalgen",
	"Chaotic Lower Reshanta",
	"Chaotic Middle Reshanta",
	"Chaotic Upper Reshanta",
	"Pantheon",
	"Fire Temple Arena",
	"Impetusium Arena",
	"Odyle Shard Cradle",
	"Stormslumber Snowfield",
	"Sandstorm Temple",
	"Subjugation Closed",
	"Beritra Brigade Fortress",
	"Orcus's Grave",
	"Fafnite Forge",
	"Silent Graveyard",
	"Fafnite Amphitheater",
	"Dream Crossroad",
	"Dream of Torment",
	"Nightmare",
	"Narun's Dream",
	"Subspace of Ascension",
	"Dream of Shattered Fragments",
	"Coastal Cave",
	"Etheria Rift",
	"Dream Remnants",
	"Illusion Sanctum",
	"Root Cellar",
	"Aullaeu Altar",
	"Illusion Hideout",
	"Zumion Relic Storage",
	"Nahid Disposal Plant",
	"Ardus Shrine",
	"Illicit Trade Spot",
	"Forgotten Battlefield",
	"Zikel's Collapsed Barracks",
	"Zikel's Distorted Dream / Kaisinel's Distorted Dream",
	"Clione Lake Cave / Tunapre Lake Cave",
	"Fountain of Life",
	"Light Crash Site",
	"Lepharist Research Center",
	"Chloris's Abyss / Sigebert's Abyss",
	"Crypt",
	"Zikel's Sanctum",
	"Collapsed Oracle",
	"Root of the Sacred Tree",
	"Dranactus Underkeep",
	"Destruction Archon Underground Fortress",
	"Blades Hideout",
	"Impetusium",
	"Kaisinel's Collapsed Sanctum",
	"Shaded Cave / Cursed Hideout (+2)",
	"Mysterious Grotto / Karat's Nest (+11)",
	"Blades Secret Storage",
	"Executioner's Tower",
	"Floating Temple of Arkanis",
	"Fire Temple",
	"Slumbering Frozen Lake Cave / Sunken Ancient Legacy (+2)",
	"Poacher's Den / Dusk Pit / Patamor Marauder Base",
	"Spirit Flower Cave / Solitary Rock Tomb (+3)",
	"Mysterious Mushroom Cave / Wild Kuru Habitat (+3)",
	"Cave of the Defeated / Krall Barracks (+3)",
	"Filth Pit / Hidden Valley (+2)",
	"Illusionary Ruins / Anguish Hideout (+9)",
	"Dehinon's Hideout / Victims' Cave (+3)",
	"Guardian's Armory / Trickster's Den (+4)",
	"Cave of the Desperate / Bibliophile's Grave (+3)",
	"Distorted Cave / Lupyllini Habitat (+5)",
	"Corrupted Spiritmaster's Residence / Deadly Poison Den (+6)",
	"Kius' Residence / Looted Repository (+6)",
	"Abandoned Odylium Cave / Hidden Vein Cave / Spider Cave",
	"Marsh Library / Red Dragon Altar (+4)",
	"Canyon Library / Library of Wisdom (+2)",
	"Cave Storage / Abandoned Archon Jail (+3)",
	"Akilo Thieves Den / Renegade Base (+8)",
	"Herb Cave / Valka's Nest (+3)",
	"Looted Pilgrim's Rest / Ratcatchers Base (+2)",
	"Broken Hall of Knowledge / Warriors' Rest (+4)",
	"Fortress Jail / Prison of Exiles / Library of Foresight",
	"Scribe's Room / Life Daeva Library",
	"Fissure Cave / Prison of Oblivion",
	"Klaw Den / Poisonous Plant Habitat / Dark Root Cave",
	"Deep and Dark Pit / Abandoned Memorial Room (+5)",
	"Fortress Grave / Frozen Land of Fate",
	"Kraka's Altar / Fanatics' Den (+2)",
	"Balaur Scouts Campsite / Drana Depository / Lagta Fafnite Storage",
	"Experimental Prison Compound / Balaur Scouts Outpost (+3)",
	"Laborers Training Ground / Homish's Prison Compound / Abandoned Drakan Prison",
	"Konutin's Cave / Howling Den",
	"Plantation Storage / Ishtar Logistics Base (+5)",
	"Forest Library / Verdandi's Oratory",
	"Hidden Lepharist Research Center",
	"Abandoned Life Hideout / Forgotten Fire Altar / Tsenka Merchants Secret Library",
	"Life Awakening Site",
	"Defunct Creion Laboratory",
	"Lepharist Special Operations Research Center / Gravarax Research Center / Lepharist Laboratory",
	"Barrier Tower Fortress Vault",
	"Forgotten Spring",
	"Fugitive Hideout / Treasure Hunter's Residence (+2)",
	"Lost Ruins / Den of Exiles / Mysterious Ruins",
	"Kumbahum's Cave",
	"Destroyed Scriptorium",
	"Library of Patience",
	"Land of Raging Flame / Guardian Statues' Cave / Lava Canyon Cave",
	"Cave of the Exiled Ones",
	"Fire Cave",
	"Indnath Secret Base",
	"Iralcig Naga Cave / Hilsrother Loot Depository",
	"Ruins of the Ancient City of Ru",
	"Nyerk Shooter",
	"Accursed Sword",
	"Beritra Air Raid / Incursion of the Spirits",
	"Shugo's Dilemma",
	"Up! Up! Up! / Not This Tile?",
	"Jump Jump",
	"Hidden Lugi",
	"Mysterious Track",
	"Wraith Evasion",
	"Goldrin's Treasure / Odyle Flight Frenzy / Defend Shugo Merchants",
	"Abyss Corridor",
	"Krao Cave",
	"Urugugu Canyon",
	"Fire Temple (Fire Temple)",
	"Draupnir",
	"Dying Dramata's Nest",
	"Vakron Sky Island",
	"Abyssal Forge: Ludra",
	"Ferocious Horn Den",
	"Cradle of Nihility",
	"Hall of Illusion",
	"Azure Breath Island",
	"Citadel of the Fallen Daeva",
	"Submerged Life Temple",
	"Mirror of Scarlet Desire",
	"Deus Research Base",
	"Shattered Arkanis",
	"Abyssal Horn Den",
	"Corroded Decontamination Facility",
	"Chalice of Muspel",
	"Daeva Bio-Research Base",
	"Crobakhi's Secret Depository",
	"Nightmare Altar (Easy) / Nightmare Altar (Normal) (+4)",
	"Tyrant's Hideout (Easy) / Tyrant's Hideout (Normal) (+4)",
	"Sanctum of Loathing (Easy) / Sanctum of Loathing (Normal) (+4)",
	"Depository of Fates (Easy) / Depository of Fates (Normal) (+4)",
	"Forgotten Repository (Easy) / Forgotten Repository (Normal) (+5)",
	"Chamber of the Dead (Easy) / Chamber of the Dead (Normal) (+5)",
}

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
