// The privacy notice (#/privacy, privacy.js) with its styles and its text, docs/privacy.md:
// loaded with the page (main.js, lazy.js), not with the first one.
import '../privacy.css';
import notice from '../../docs/privacy.md?raw';
import { privacyPage } from '../privacy.js';
export const privacyNotice = () => privacyPage(notice);
