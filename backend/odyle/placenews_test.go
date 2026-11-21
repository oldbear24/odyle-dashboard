package odyle

import (
	"net/http"
	"strconv"
	"testing"
	"time"
)

// A place is written alone; while a character flies its rooms hear of its places at most every
// placeNewsGap, always ending with the latest, while its owner hears of each one, and a load,
// an arrival or any other change reaches the rooms at once.
func TestFlightPlacesReachRoomsInAWhile(t *testing.T) {
	gap := placeNewsGap
	placeNewsGap = 2 * time.Second
	t.Cleanup(func() { placeNewsGap = gap })
	app := newTestApp(t)
	if _, err := writeSettings(app, body{"portraitsPaused": true}); err != nil {
		t.Fatal(err)
	}
	pilot, mate := newUser(t, app, "Pilot"), newUser(t, app, "Mate")
	pilot.Set("shareLocation", true)
	if err := app.Save(pilot); err != nil {
		t.Fatal(err)
	}
	session := saved(t, app, "publisher_sessions", map[string]any{"user": pilot.Id, "expiresAt": expiry(86400)})
	c := saved(t, app, "characters", map[string]any{"user": pilot.Id, "characterName": "Glider", "server": "Lumiel", "region": "GLOBAL_EU", "value": 120, "confirmed": true})
	room := saved(t, app, "party_rooms", map[string]any{"owner": pilot.Id, "name": "Sky", "cost": 40})
	sharingMember(t, app, map[string]any{"room": room.Id, "user": pilot.Id, "role": "owner"}, c.Id)
	saved(t, app, "room_members", map[string]any{"room": room.Id, "user": mate.Id, "role": "reporter"})
	deliver(app)
	mates, own := listen(t, app, mate, roomTopic+room.Id), listen(t, app, pilot, userTopic+pilot.Id)
	auth := tokenOf(t, pilot)
	post := func(source string, x float64) {
		t.Helper()
		ask(t, app, http.MethodPost, "/api/odyle/location", auth, `{"sessionId":"`+session.Id+`","characterId":"`+c.Id+`","adapter":"global-location-v1","map":1110,"x":`+formatFloat(x)+`,"y":1,"z":2,"source":"`+source+`"}`, 200)
	}
	heard := func(l *listener) (x float64, value float64) {
		t.Helper()
		_, data, ok := l.next()
		if !ok {
			t.Fatal("heard nothing")
		}
		list, _ := data["characters"].([]any)
		if len(list) != 1 {
			t.Fatalf("heard %v", data)
		}
		character := list[0].(map[string]any)
		place, _ := character["location"].(map[string]any)
		return place["x"].(float64), character["value"].(float64)
	}

	// The first place of a flight reaches everyone at once.
	post("flight", 10)
	deliver(app)
	if x, _ := heard(mates); x != 10 {
		t.Fatalf("the room heard x %v", x)
	}
	if x, _ := heard(own); x != 10 {
		t.Fatalf("the owner heard x %v", x)
	}
	// More places within the gap: the owner hears each, the room nothing yet.
	post("flight", 20)
	deliver(app)
	if x, _ := heard(own); x != 20 {
		t.Fatalf("the owner heard x %v", x)
	}
	post("effect", 30)
	deliver(app)
	if x, _ := heard(own); x != 30 {
		t.Fatalf("the owner heard x %v", x)
	}
	mates.quiet()
	// Another change of the character reaches the room at once, with the place written.
	record, err := app.FindRecordById("characters", c.Id)
	if err != nil {
		t.Fatal(err)
	}
	if place, _ := parseJSON(record.GetString("location"), "null").(map[string]any); place["x"] != float64(30) || record.GetInt("value") != 120 {
		t.Fatalf("saved %v, value %d", place, record.GetInt("value"))
	}
	record.Set("value", 80)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	deliver(app)
	if x, value := heard(mates); x != 30 || value != 80 {
		t.Fatalf("the room heard x %v value %v", x, value)
	}
	heard(own)
	// The gap ends: the room hears the character as it is now, with the latest place.
	post("flight", 40)
	deliver(app)
	heard(own)
	time.Sleep(placeNewsGap + 100*time.Millisecond)
	deliver(app)
	if x, value := heard(mates); x != 40 || value != 80 {
		t.Fatalf("after the gap the room heard x %v value %v", x, value)
	}
	// An arrival reaches the room at once, even within a gap.
	post("flight", 50)
	deliver(app)
	heard(own)
	mates.quiet()
	post("arrival", 60)
	deliver(app)
	if x, _ := heard(mates); x != 60 {
		t.Fatalf("the arrival reached the room as x %v", x)
	}
	// Nothing came after the arrival: the gap ends without news, and the next flight place
	// reaches the room at once again.
	time.Sleep(2*placeNewsGap + 100*time.Millisecond)
	deliver(app)
	mates.quiet()
	heard(own)
	post("flight", 70)
	deliver(app)
	if x, _ := heard(mates); x != 70 {
		t.Fatalf("a new flight reached the room as x %v", x)
	}
}

func formatFloat(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }
