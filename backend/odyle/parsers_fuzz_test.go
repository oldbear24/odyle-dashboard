package odyle

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Fuzz tests of the parsers of what PLAYNC answers (R1: nothing it sends is trusted). Each is
// seeded with the shapes the tests and docs/armory.md show, then with what readers might see
// when PLAYNC changes its pages: wrong types, huge numbers, missing lists. go test runs the
// seeds; CI fuzzes each target for a few seconds (the go-fuzz job).

// answerOf is what the stand of a fuzz test answers with now.
type answerOf struct{ body atomic.Pointer[[]byte] }

func (a *answerOf) set(raw []byte) { a.body.Store(&raw) }

// stand is a PLAYNC that answers every request with the raw bytes set last.
func (a *answerOf) stand(t testing.TB) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if raw := a.body.Load(); raw != nil {
			w.Write(*raw)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

// objectOf is raw as the JSON object PLAYNC answers, or false.
func objectOf(raw []byte) (map[string]any, bool) {
	var m map[string]any
	return m, json.Unmarshal(raw, &m) == nil && m != nil
}

var digitsOnly = regexp.MustCompile(`^-?[0-9]+(.[0-9]+)?$`)

// officialItemSeeds are item pages: the tests' own, then the doc samples that look like one.
func officialItemSeeds(f *testing.F) [][]byte {
	item, _ := json.Marshal(officialItem())
	seeds := [][]byte{item}
	for _, sample := range armoryDocSamples(f) {
		if strings.Contains(string(sample), "mainStats") || strings.Contains(string(sample), "subStats") {
			seeds = append(seeds, sample)
		}
	}
	return seeds
}

// readItem takes any item page: it never panics, and the details it reads stay within their
// limits and marshal.
func FuzzReadItem(f *testing.F) {
	for _, seed := range officialItemSeeds(f) {
		f.Add(seed)
	}
	f.Add([]byte(`{"name":"x","mainStats":[{"name":"a","value":1e999}],"classNames":[1,null,{"a":1}],"set":{"name":"s","items":"no","bonuses":[null]}}`))
	f.Add([]byte(`{"name":"x","level":1e300,"maxEnchantLevel":-1,"subSkills":[{"name":"y","level":"3","icon":"https://example.com/x.png"}],"magicStoneStat":{"a":1},"costumes":[[]]}`))
	f.Add([]byte(`{"name":"<img src=x onerror=alert(1)>","desc":"` + strings.Repeat("😀", 500) + `","set":{"name":"s","items":[],"bonuses":[{"degree":2,"descriptions":[1,2,3]}]}}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		m, ok := objectOf(raw)
		if !ok {
			return
		}
		item := readItem(m)
		if item == nil {
			return
		}
		if len(item.Main) > 12 || len(item.Sub) > 12 || len(item.Stones) > 8 || len(item.GodStones) > 4 || len(item.SubSkills) > 8 || len(item.Classes) > 10 ||
			len(item.Sources) > 8 || len(item.Skins) > 6 || length(item.Desc) > 400 || length(item.Category) > 40 {
			t.Fatalf("limits of %+v", item)
		}
		if item.Set != nil && (item.Set.Name == "" || len(item.Set.Items) > 10 || len(item.Set.Bonuses) > 6) {
			t.Fatalf("set of %+v", item.Set)
		}
		for _, line := range append(append([]armoryLine{}, item.Main...), item.Sub...) {
			// A value sent as a number is written out whole whatever its length (jsonValue applies its
			// limit to text only: 1e300 becomes 301 digits), so only texts are held to 20.
			tooLong := func(v string) bool { return length(v) > 20 && !digitsOnly.MatchString(v) }
			if line.Name == "" || length(line.Name) > 60 || tooLong(line.Value) || tooLong(line.Min) || tooLong(line.Extra) {
				t.Fatalf("line %+v", line)
			}
		}
		if _, err := json.Marshal(item); err != nil {
			t.Fatal(err)
		}
	})
}

// boardSeeds are board pages: the tests' own, then the doc samples that look like one.
func boardSeeds(f *testing.F) [][]byte {
	board, _ := json.Marshal(officialBoard())
	seeds := [][]byte{board}
	for _, sample := range armoryDocSamples(f) {
		if strings.Contains(string(sample), "nodeList") {
			seeds = append(seeds, sample)
		}
	}
	return seeds
}

// readBoard takes any board page: it never panics, keeps at most 400 nodes in the board's
// order and at most 80 effects of each kind.
func FuzzReadBoard(f *testing.F) {
	for _, seed := range boardSeeds(f) {
		f.Add(seed)
	}
	f.Add([]byte(`{"nodeList":[{"row":1e300,"col":-1e300,"type":"Stat","open":"1","name":"x","effectList":[{"desc":"y"},null,3]}],"openStatEffectList":"no"}`))
	f.Add([]byte(`{"nodeList":[null,1,"a",{"type":"None"},{"type":"Skill","row":2,"col":9007199254740993}],"openSkillEffectList":[{"desc":null}]}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		m, ok := objectOf(raw)
		if !ok {
			return
		}
		board := &armoryBoard{Nodes: []armoryNode{}}
		readBoard(board, m)
		if len(board.Nodes) > 400 || len(board.StatEffects) > 80 || len(board.SkillEffects) > 80 || board.StatEffects == nil || board.SkillEffects == nil {
			t.Fatalf("limits of %d nodes, %v, %v", len(board.Nodes), board.StatEffects, board.SkillEffects)
		}
		for _, n := range board.Nodes {
			if n.Type == "" || n.Type == "None" || length(n.Type) > 20 || length(n.Name) > 80 {
				t.Fatalf("node %+v", n)
			}
		}
		if _, err := json.Marshal(board); err != nil {
			t.Fatal(err)
		}
	})
}

// askServers takes any server list: the ids it names belong to the region asked about and
// have a name of letters, or it fails.
func FuzzAskServers(f *testing.F) {
	stand := &answerOf{}
	server := stand.stand(f)
	f.Setenv("PLAYNC_ARMORY_URL", server.URL)
	f.Add([]byte(`{"serverList":[{"raceId":1,"serverId":1311,"serverName":"Tahavatha","serverShortName":"Tah"},{"raceId":2,"serverId":2323,"serverName":"Tassin"}]}`), 3)
	f.Add([]byte(`{"serverList":[{"serverId":1e300,"serverName":"Big"},{"serverId":"2323","serverName":"Text"},{"serverId":-1311,"serverName":"Minus"},null,"x"]}`), 3)
	f.Add([]byte(`{"serverList":{"serverId":1311}}`), 3)
	f.Add([]byte(`{"serverList":[{"serverId":3399,"serverName":"Edge"},{"serverId":1301,"serverName":"A"},{"serverId":1301,"serverName":"<b>x</b>"}]}`), 3)
	f.Add([]byte(`[]`), 1)
	f.Fuzz(func(t *testing.T, raw []byte, digit int) {
		digit = 1 + (digit%5+5)%5
		stand.set(raw)
		got, err := askServers(digit)
		if err != nil {
			if len(got) != 0 {
				t.Fatalf("%v with %v", err, got)
			}
			return
		}
		if len(got) == 0 {
			t.Fatal("no servers and no error")
		}
		for id, name := range got {
			if id/1000 < 1 || id/1000 > 2 || id/100%10 != digit || id%100 < 1 || !pvpServer.MatchString(name) {
				t.Fatalf("server %d %q for region %d", id, name, digit)
			}
		}
	})
}

// searchServer takes any search answer: the hit it names has a character id PLAYNC could have
// (or "-"), the server asked about and a portrait link on the portrait host.
func FuzzSearchServer(f *testing.F) {
	stand := &answerOf{}
	server := stand.stand(f)
	f.Setenv("PLAYNC_SEARCH_URL", server.URL)
	f.Setenv("PLAYNC_IMAGE_URL", server.URL)
	f.Add([]byte(`{"list":[{"name":"Hero","serverId":2304,"level":45,"pcId":36,"characterId":"kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4%3D","profileImageUrl":"/images?a=1"}],"pagination":{"total":1}}`))
	f.Add([]byte(`{"list":[{"name":"<strong>Hero</strong>","serverId":2304,"level":1e300,"pcId":-5,"characterId":"%zz","profileImageUrl":"https://evil.example/x"}],"pagination":{"total":"many"}}`))
	f.Add([]byte(`{"list":[{"name":"Hero","serverId":"2304","characterId":null},null,1,[]],"pagination":null}`))
	f.Add([]byte(`{"list":"no"}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		stand.set(raw)
		hit, err := searchServer("Hero", search{serverId: 2304, region: "eu"})
		if err != nil || hit.id == "" {
			return
		}
		if hit.serverId != 2304 || hit.region != "eu" || hit.level < 0 || hit.classId < 0 || hit.id != "-" && !armoryIds.MatchString(hit.id) {
			t.Fatalf("hit %+v", hit)
		}
		if hit.link != "" && !strings.HasPrefix(hit.link, server.URL+"/") {
			t.Fatalf("a portrait link off the portrait host: %q", hit.link)
		}
	})
}

// The armory's search lists up to 20 hits, each a character id PLAYNC could have on the server
// asked about, whatever the answer says; exact names come first.
func FuzzArmorySearch(f *testing.F) {
	stand := &answerOf{}
	server := stand.stand(f)
	f.Setenv("PLAYNC_SEARCH_URL", server.URL)
	spaced := armorySearchGap
	armorySearchGap = time.Millisecond
	f.Cleanup(func() { armorySearchGap = spaced })
	f.Add([]byte(`{"list":[{"name":"Hero","level":45,"race":2,"serverId":2304,"pcId":36,"characterId":"kdPX-_ocYSqMloiCy7IXZ0CDm-uNeqFNcUjEyfl3We4%3D"},{"name":"Heroine","serverId":2304,"characterId":"abcdefgh"}]}`))
	f.Add([]byte(`{"list":[{"name":"Hero","level":"45","race":1e300,"serverId":2304.5,"characterId":"abcdefgh%"},{"name":"` + strings.Repeat("😀", 100) + `","serverId":2304,"characterId":"abcdefghij"}]}`))
	f.Add([]byte(`{"list":[null,[],{"serverId":2304,"characterId":{"a":1}}]}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		stand.set(raw)
		hits, err := newArmorySearches().find(staticServers(), "Hero", "Lumiel", "GLOBAL_EU")
		if err != nil {
			return
		}
		if len(hits) > 20 {
			t.Fatalf("%d hits", len(hits))
		}
		exact := true
		for _, h := range hits {
			if h.ServerId != 2304 || h.Server != "Lumiel" || !armoryIds.MatchString(h.CharacterId) || length(h.Name) > 40 || h.Level < 0 || h.Race < 0 {
				t.Fatalf("hit %+v", h)
			}
			// Exact names come before the others.
			if !strings.EqualFold(h.Name, "Hero") {
				exact = false
			} else if !exact {
				t.Fatalf("an exact name after another: %+v", hits)
			}
		}
	})
}

var classIconFile = regexp.MustCompile(`^class_icon_[a-z]+\.png$`)

// learnClasses takes any list of classes: it never panics, and the classes it keeps have a
// name of up to 40 characters and no emblem but the game's own file names.
func FuzzLearnClasses(f *testing.F) {
	stand := &answerOf{}
	server := stand.stand(f)
	f.Setenv("PLAYNC_ARMORY_URL", server.URL)
	f.Setenv("PLAYNC_CLASS_ICONS_URL", server.URL+"/class/")
	app := newTestApp(f)
	f.Add([]byte(`{"pcDataList":[{"id":36,"className":"CHANTER","classText":"Chanter","genderName":"Female","raceName":"Asmodians"},{"id":1,"className":"GLADIATOR","classText":"Gladiator"}]}`))
	f.Add([]byte(`{"pcDataList":[{"id":1e300,"className":"../../etc","classText":"x"},{"id":-3,"className":"AB","classText":"y"},{"id":"7","className":"AB","classText":"y"},null,"x"]}`))
	f.Add([]byte(`{"pcDataList":[{"id":99,"className":"Zz","classText":"<b>` + strings.Repeat("é", 100) + `</b>"}]}`))
	f.Add([]byte(`{"pcDataList":{}}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		stand.set(raw)
		_ = learnClasses(app)
		for _, c := range gameClassesFresh(t, app) {
			if length(c.Name) > 40 || c.Icon != "" && !classIconFile.MatchString(c.Icon) {
				t.Fatalf("class %+v", c)
			}
		}
	})
}

// gameClassesFresh reads game_classes as the database holds them now, not as kept.
func gameClassesFresh(t testing.TB, app core.App) []gameClass {
	t.Helper()
	rows := []gameClass{}
	if err := app.DB().NewQuery("SELECT pcId, name, icon FROM game_classes").All(&rows); err != nil {
		t.Fatal(err)
	}
	return rows
}
