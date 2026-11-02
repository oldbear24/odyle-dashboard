// What's new (#/changelog, whatsnew.js) with its styles and the changelog it lists, CHANGELOG.md,
// which grows with every release: loaded with the page (main.js, lazy.js), not with the first one.
import '../whatsnew.css';
import changelogText from '../../CHANGELOG.md?raw';
import { parseChangelog } from '../changelog.js';
export { whatsNew } from '../whatsnew.js';
export const changelog = parseChangelog(changelogText);
