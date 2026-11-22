import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { party, character } from '../../src/readiness.js';
// Party readiness (src/readiness.js) against the shared cases in readiness-vectors.json,
// which later Go and C# ports of the rules run too.
const vectors = JSON.parse(readFileSync(new URL('../readiness-vectors.json', import.meta.url), 'utf8'));
const ids = list => list.map(c => c.id);
test("the party counts each player's best live character and the lowest player's cubes", async () => {
  const now = Date.parse(vectors.now);
  for (const { name, cost, entries, expect } of vectors.parties) {
    const result = party(entries, now, cost);
    assert.deepEqual(
      {
        characters: ids(result.characters),
        live: ids(result.live),
        ready: ids(result.ready),
        players: ids(result.players),
        lowest: result.lowest?.id ?? null,
        cubes: result.cubes,
        uncounted: result.uncounted,
      },
      expect,
      name,
    );
  }
  assert.deepEqual(party([], now, 40), {
    characters: [],
    live: [],
    ready: [],
    players: [],
    lowest: null,
    cubes: 0,
    uncounted: [],
  });
});
test('a character is ready only while live with enough for a cube; saved values keep their cubes', async () => {
  const now = Date.parse(vectors.now);
  for (const { name, cost, character: c, expect } of vectors.characters)
    assert.deepEqual(character(c, now, cost), expect, name);
});
