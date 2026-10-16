// The changelog for the release workflow and by hand (src/changelog.js reads CHANGELOG.md):
//
//   node scripts/changelog.mjs check [version]   the section of the version (default:
//                                               package.json's) is there and lists something
//   node scripts/changelog.mjs notes <version>   prints that section as release notes
import { readFileSync } from 'node:fs';
import { parseChangelog, entryOf, changelogProblem, releaseNotes } from '../src/changelog.js';

const text = readFileSync('CHANGELOG.md', 'utf8');
const [mode, given] = process.argv.slice(2);
const version = given || JSON.parse(readFileSync('package.json', 'utf8')).version;
const fail = message => { console.error('::error::' + message); process.exit(1); };
const problem = changelogProblem(text, version);
if (mode === 'check') { if (problem) fail(problem); console.log(`CHANGELOG.md describes ${version}.`); }
else if (mode === 'notes') { if (problem) fail(problem); process.stdout.write(releaseNotes(entryOf(parseChangelog(text), version)) + '\n'); }
else fail('Usage: node scripts/changelog.mjs check [version] | notes <version>');
