// The dashboard's shared state (#192): what the pages, dialogs and the session read and change
// across modules. Each part of the dashboard keeps what only it uses in its own module.
import { defaultClock } from '../clock.js';
import { defaults as resetDefaults } from '../tasks.js';

// localStorage can be missing or throw (private modes, blocked storage); every use goes through this.
export const storage = (() => {
  try {
    const s = window.localStorage;
    s.getItem('odyle.probe');
    return s;
  } catch {
    return { getItem: () => null, setItem() {}, removeItem() {} };
  }
})();
export const tabStorage = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
})();

export const state = {
  // The open room (room.js) with what its snapshot brought; demo while the demo workspace is open.
  room: null,
  members: [],
  wishlist: [],
  runs: [],
  dungeons: [],
  catalog: [],
  demo: false,
  // Each class's role in a party from the snapshot (#45), for the make-up of planned runs.
  classRoles: [],
  // The room's information board (board.js): its text, who wrote it last and when, or null.
  board: null,
  // The party's week (#42): what the characters shared in the room spent since the weekly reset.
  roomWeek: null,
  // Whether the operator paused Discord reminders (the snapshot says so; Room settings tells the owner, #49).
  remindersPaused: false,
  // The game's weekly maintenance window from the snapshot (#47); runs inside it say so.
  maintenance: null,
  // The account's rooms (roomsKnown once they were listed) and its saved characters
  // (charactersKnown once they were listed: until then none of them is new).
  rooms: [],
  roomsKnown: false,
  characters: [],
  charactersKnown: false,
  // The account's own Windows readers (readers in GET /rooms and the snapshot), kept current
  // by the heartbeats on its own topic: buttons name the PC that reads instead of asking to
  // connect one.
  readers: [],
  // The runs you go to in the next two weeks, for Rooms & characters (#51).
  nextRunsList: [],
  // Whether the server answered (online), realtime is connected (live) and a form is on its way (busy).
  online: false,
  live: false,
  busy: false,
  // The server's clock minus this browser's, and the rules the server names.
  serverOffset: 0,
  perCube: 40,
  clockRules: defaultClock,
  resets: { ...resetDefaults },
  // The game's maps as superusers named them (location sharing, places.js).
  gameMaps: [],
  // The classes' emblems by class name (backend/odyle/classes.go), with the room list and rooms.
  classIcons: {},
  // How long the server keeps the Odyle history and the places (Game settings), for the help.
  keptDays: { historyDays: 30, locationDays: 30, pvpDays: 90 },
  // The newest Windows app release as the backend last reported it; refreshed every ten minutes at most.
  windowsRelease: null,
  windowsReleaseAt: 0,
  // The account page's data, and the notification settings the account's news or upcoming runs last named.
  account: null,
  notificationsSeen: null,
  // The page on screen (null: a page that failed to load), the navigation under way and the
  // navigation the shell was last drawn for (router.js).
  shown: null,
  navigation: 0,
  drawn: 0,
  // The open room's realtime topics, to leave with it.
  roomTopics: [],
};

export function clearRoom() {
  Object.assign(state, {
    room: null,
    members: [],
    board: null,
    wishlist: [],
    runs: [],
    dungeons: [],
    catalog: [],
    classRoles: [],
    demo: false,
  });
}
export async function leaveRoomTopic() {
  const stops = state.roomTopics;
  state.roomTopics = [];
  for (const stop of stops)
    await stop().catch(() => {
      /* already gone */
    });
}

// The last signed-in page is remembered so a fresh visit resumes there, and the last room for
// the navigation.
const memoryKey = 'odyle.location';
export function remembered() {
  try {
    return JSON.parse(storage.getItem(memoryKey)) || {};
  } catch {
    return {};
  }
}
export function remember(path) {
  try {
    storage.setItem(
      memoryKey,
      JSON.stringify({ path, room: path.startsWith('/room/') ? path.slice(6) : remembered().room }),
    );
  } catch {
    /* storage full or blocked */
  }
}
export function forget(id) {
  try {
    if (!id) storage.removeItem(memoryKey);
    else if (remembered().room === id) storage.setItem(memoryKey, JSON.stringify({ path: '/' }));
  } catch {
    /* storage blocked */
  }
}
