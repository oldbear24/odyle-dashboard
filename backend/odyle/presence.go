package odyle

import (
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Presence. A running Windows app sends a heartbeat every 20 seconds: its reader
// session is in contact and, while the game is connected, the character it reads is
// seen. Heartbeats are kept in memory and written to the database every ten seconds in
// one transaction (the characters' lastSeenAt, the sessions' updated and expiresAt),
// instead of two writes per heartbeat. Answers use the latest heartbeat even before it
// is written: snapshots, the characters collection, the account page and the
// superuser dashboard. The character's rooms and its owner hear of every heartbeat over
// realtime (realtime.go), so clients keep presence current without fetching again.
const presenceWrite = 10 * time.Second

// heartbeats older than this are written and forgotten; the database answers for them.
const presenceKept = 2 * time.Minute

type contact struct {
	at      time.Time
	written bool
}

type seen struct {
	session string
	at      time.Time
	written bool
}

type presence struct {
	mu         sync.Mutex
	sessions   map[string]contact // by reader session
	characters map[string]seen    // by character
}

func newPresence() *presence {
	return &presence{sessions: map[string]contact{}, characters: map[string]seen{}}
}

func presenceOf(app core.App) *presence { return stateOf(app).presence }

// beat records a heartbeat of the session and, when it reads one (character is not
// nil), its character, and tells the character's rooms and its owner.
func beat(app core.App, session *ReaderSession, character *Character, at time.Time) {
	p, owner := presenceOf(app), session.User()
	p.mu.Lock()
	p.sessions[session.Id] = contact{at: at}
	if character != nil {
		p.characters[character.Id] = seen{session: session.Id, at: at}
	}
	p.mu.Unlock()
	sightings(app).user(app, owner, func(n *userNews) {
		n.contact[session.Id] = at
		if character != nil {
			n.seen[character.Id] = at
		}
	})
	if character == nil {
		return
	}
	roomIds, err := roomsFor(app, owner)
	if err != nil {
		warn(app, "Odyle realtime delivery failed", "character", character.Id, "error", err.Error())
	}
	for _, id := range unique(roomIds) {
		sightings(app).room(app, id, func(n *roomNews) { n.seen[character.Id] = sighting{owner: owner, at: at} })
	}
}

// seenAt is the character's latest heartbeat when it is newer than its stored
// lastSeenAt and came from the session that reads it.
func seenAt(app core.App, c *Character) (time.Time, bool) {
	p := presenceOf(app)
	p.mu.Lock()
	s, ok := p.characters[c.Id]
	p.mu.Unlock()
	if !ok || s.session != c.ReadingSession() || !s.at.After(timeOf(c.LastSeenAt())) {
		return time.Time{}, false
	}
	return s.at, true
}

// present sets a character's lastSeenAt to its latest heartbeat, for an answer; the
// record is not saved.
func present(app core.App, c *Character) {
	if at, ok := seenAt(app, c); ok {
		c.SetLastSeenAt(at)
	}
}

// contactAt is the reader session's last contact: its latest heartbeat, or the stored
// updated time when that is newer.
func contactAt(app core.App, session *ReaderSession) string {
	p := presenceOf(app)
	p.mu.Lock()
	c, ok := p.sessions[session.Id]
	p.mu.Unlock()
	if ok && c.at.After(timeOf(session.Updated())) {
		return stamp(c.at)
	}
	return session.Updated()
}

// write stores the heartbeats not written yet. A character keeps a later lastSeenAt
// (a reading saved it) and one another session reads now; a session keeps a later
// contact. It is safe to call at any time; the backend calls it every ten seconds and
// when it stops.
func (p *presence) write(app core.App) error {
	type row struct {
		id, session string
		at          time.Time
	}
	var characters, sessions []row
	p.mu.Lock()
	for id, s := range p.characters {
		if !s.written {
			characters = append(characters, row{id, s.session, s.at})
		}
	}
	for id, c := range p.sessions {
		if !c.written {
			sessions = append(sessions, row{id: id, at: c.at})
		}
	}
	p.mu.Unlock()
	if len(characters)+len(sessions) > 0 {
		if err := app.RunInTransaction(func(tx core.App) error {
			for _, r := range characters {
				if _, err := tx.DB().NewQuery("UPDATE {{characters}} SET [[lastSeenAt]] = {:at} WHERE [[id]] = {:id} AND [[readingSession]] = {:session} AND [[lastSeenAt]] < {:at}").
					Bind(dbx.Params{"at": stamp(r.at), "id": r.id, "session": r.session}).Execute(); err != nil {
					return err
				}
			}
			for _, r := range sessions {
				if _, err := tx.DB().NewQuery("UPDATE {{publisher_sessions}} SET [[updated]] = {:at}, [[expiresAt]] = {:expires} WHERE [[id]] = {:id} AND [[updated]] < {:at}").
					Bind(dbx.Params{"at": stamp(r.at), "expires": stamp(r.at.Add(24 * time.Hour)), "id": r.id}).Execute(); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return err
		}
	}
	cutoff := time.Now().Add(-presenceKept)
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, r := range characters {
		if s := p.characters[r.id]; s.at.Equal(r.at) {
			s.written = true
			p.characters[r.id] = s
		}
	}
	for _, r := range sessions {
		if c := p.sessions[r.id]; c.at.Equal(r.at) {
			c.written = true
			p.sessions[r.id] = c
		}
	}
	for id, s := range p.characters {
		if s.written && s.at.Before(cutoff) {
			delete(p.characters, id)
		}
	}
	for id, c := range p.sessions {
		if c.written && c.at.Before(cutoff) {
			delete(p.sessions, id)
		}
	}
	return nil
}

// forget drops what a session sent once it ended.
func (p *presence) forget(session string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.sessions, session)
	for id, s := range p.characters {
		if s.session == session {
			delete(p.characters, id)
		}
	}
}

// watchPresence writes the heartbeats every ten seconds while the backend serves and
// once more when it stops, and puts the latest heartbeat into the characters
// collection's answers.
func watchPresence(app core.App) {
	stop := make(chan struct{})
	var once sync.Once
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		go func() {
			ticker := time.NewTicker(presenceWrite)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case <-ticker.C:
					if err := presenceOf(se.App).write(se.App); err != nil {
						warn(se.App, "Odyle could not write heartbeats", "error", err.Error())
					}
				}
			}
		}()
		return se.Next()
	})
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		once.Do(func() { close(stop) })
		if err := presenceOf(e.App).write(e.App); err != nil {
			warn(e.App, "Odyle could not write heartbeats", "error", err.Error())
		}
		return e.Next()
	})
	app.OnRecordEnrich("characters").BindFunc(func(e *core.RecordEnrichEvent) error {
		present(e.App, viewOf[Character](e.Record))
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("publisher_sessions").BindFunc(func(e *core.RecordEvent) error {
		presenceOf(e.App).forget(e.Record.Id)
		return e.Next()
	})
}
