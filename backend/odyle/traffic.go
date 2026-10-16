package odyle

import (
	"math"
	"sort"
	"sync"
	"time"
)

// Odyle's requests of the last hour for the superuser dashboard's Server status page:
// per minute and route how many arrived, how many were rejected and why, and how long
// they took. Packets (POST routes) count with the source they came from, the Windows app
// or the dashboard; reads (GET routes) count as reads and are never listed as packets.
// Like packets this lives in server memory only, one entry per minute, and a restart
// clears it. Requests refused before Odyle handles them (no sign-in) are not counted.
const trafficHour = 60

// Handling time buckets: up to 1 ms, up to 2 ms, … up to 5 s; the last holds anything slower.
var timeBounds = []int64{1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000}

// Distinct rejection reasons kept per minute; more are still counted as rejected.
const trafficReasons = 20

func timeBucket(ms int64) int {
	for i, bound := range timeBounds {
		if ms <= bound {
			return i
		}
	}
	return len(timeBounds)
}

type routeTraffic struct {
	source          string
	count, rejected int
	totalMs, maxMs  int64
	times           []int
}

func newRouteTraffic(source string) *routeTraffic {
	return &routeTraffic{source: source, times: make([]int, len(timeBounds)+1)}
}

func (r *routeTraffic) add(other *routeTraffic) {
	r.count += other.count
	r.rejected += other.rejected
	r.totalMs += other.totalMs
	r.maxMs = max(r.maxMs, other.maxMs)
	for i, n := range other.times {
		r.times[i] += n
	}
}

type rejection struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Count   int    `json:"count"`
	LastAt  string `json:"lastAt"`
}

type trafficMinute struct {
	routes  map[string]*routeTraffic
	errors  map[string]*rejection // by kind and message
	private int                   // requests from a private or loopback client address
}

type traffic struct {
	mu      sync.Mutex
	minutes map[int64]*trafficMinute
	latest  int64 // the newest minute counted
}

func newTraffic() *traffic { return &traffic{minutes: map[int64]*trafficMinute{}} }

func minuteOf(at time.Time) int64 { return int64(math.Floor(float64(at.UnixMilli()) / 60000)) }

// minute is the entry of the minute at, made if needed (t.mu held).
func (t *traffic) minute(at time.Time) *trafficMinute {
	minute, previous := minuteOf(at), minuteOf(at)
	if t.latest != 0 {
		previous = t.latest
	}
	t.latest = max(previous, minute)
	// The minutes that left the hour since the last request, however long the pause was.
	for m := previous - trafficHour + 1; m <= min(previous, minute-trafficHour); m++ {
		delete(t.minutes, m)
	}
	entry := t.minutes[minute]
	if entry == nil {
		entry = &trafficMinute{routes: map[string]*routeTraffic{}, errors: map[string]*rejection{}}
		t.minutes[minute] = entry
	}
	return entry
}

// fromPrivate counts a handled request whose client address, the one rate limits count
// it under, is private or loopback (proxy.go).
func (t *traffic) fromPrivate(at time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.minute(at).private++
}

// record counts one handled request.
func (t *traffic) record(at time.Time, kind, source string, ms int64, failure error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	entry := t.minute(at)
	route := entry.routes[kind]
	if route == nil {
		route = newRouteTraffic(source)
		entry.routes[kind] = route
	}
	route.count++
	route.totalMs += ms
	route.maxMs = max(route.maxMs, ms)
	route.times[timeBucket(ms)]++
	if failure == nil {
		return
	}
	route.rejected++
	text := message(failure)
	if text == "" {
		text = "Rejected."
	}
	text = cut(text, 200)
	key := kind + "\n" + text
	reason := entry.errors[key]
	if reason == nil && len(entry.errors) < trafficReasons {
		reason = &rejection{Kind: kind, Message: text}
		entry.errors[key] = reason
	}
	if reason != nil {
		reason.Count++
		reason.LastAt = at.UTC().Format(isoLayout)
	}
}

// percentile is the upper bound of the bucket that holds the q-th share of the requests;
// the slowest time for the last bucket.
func percentile(r *routeTraffic, q float64) int64 {
	seen := 0
	for i, n := range r.times {
		seen += n
		if float64(seen) >= q*float64(r.count) {
			if i < len(timeBounds) {
				return min(timeBounds[i], r.maxMs)
			}
			return r.maxMs
		}
	}
	return r.maxMs
}

func timing(o *object, r *routeTraffic) *object {
	return o.set("averageMs", math.Round(float64(r.totalMs)/float64(r.count)*10)/10).
		set("medianMs", percentile(r, 0.5)).set("p95Ms", percentile(r, 0.95)).set("maxMs", r.maxMs)
}

// summary is the last 60 minutes, oldest first, each with the accepted requests by source
// and every rejected one; the routes and the rejection reasons of the whole hour, and how
// many of its requests came from a private or loopback address.
func (t *traffic) summary(at time.Time) *object {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := minuteOf(at)
	minutes, routes, reasons, all, private := []*object{}, map[string]*routeTraffic{}, map[string]*rejection{}, newRouteTraffic(""), 0
	for m := now - trafficHour + 1; m <= now; m++ {
		counts := map[string]int{}
		if entry := t.minutes[m]; entry != nil {
			private += entry.private
			for kind, route := range entry.routes {
				counts[route.source] += route.count - route.rejected
				counts["rejected"] += route.rejected
				if routes[kind] == nil {
					routes[kind] = newRouteTraffic(route.source)
				}
				routes[kind].add(route)
				all.add(route)
			}
			for key, reason := range entry.errors {
				total := reasons[key]
				if total == nil {
					total = &rejection{Kind: reason.Kind, Message: reason.Message}
					reasons[key] = total
				}
				total.Count += reason.Count
				total.LastAt = max(total.LastAt, reason.LastAt)
			}
		}
		minutes = append(minutes, newObject().set("at", time.UnixMilli(m*60000).UTC().Format(isoLayout)).
			set("app", counts["app"]).set("web", counts["web"]).set("read", counts["read"]).set("rejected", counts["rejected"]))
	}
	total := newObject().set("count", all.count).set("rejected", all.rejected)
	if all.count > 0 {
		timing(total, all)
	}
	// The busiest first.
	kinds := make([]string, 0, len(routes))
	for kind := range routes {
		kinds = append(kinds, kind)
	}
	sort.Slice(kinds, func(a, b int) bool {
		if ca, cb := routes[kinds[a]].count, routes[kinds[b]].count; ca != cb {
			return ca > cb
		}
		return kinds[a] < kinds[b]
	})
	routeList := make([]*object, len(kinds))
	for i, kind := range kinds {
		r := routes[kind]
		routeList[i] = timing(newObject().set("kind", kind).set("source", r.source).set("count", r.count).set("rejected", r.rejected), r)
	}
	errorList := make([]*rejection, 0, len(reasons))
	for _, reason := range reasons {
		errorList = append(errorList, reason)
	}
	sort.Slice(errorList, func(a, b int) bool {
		x, y := errorList[a], errorList[b]
		if x.Count != y.Count {
			return x.Count > y.Count
		}
		if x.Kind != y.Kind {
			return x.Kind < y.Kind
		}
		return x.Message < y.Message
	})
	if len(errorList) > trafficReasons {
		errorList = errorList[:trafficReasons]
	}
	return newObject().set("minutes", minutes).set("total", total).set("routes", routeList).set("errors", errorList).set("private", private)
}
