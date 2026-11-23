// The armory's pages (armory.js) with their styles: loaded with the first of them (app/parts.js,
// lazy.js), after the dashboard's own styles.
import '../armory.css';
import '../armoryhistory.css';
export * from '../armory.js';
export { bindProgress } from '../armoryhistory.js';
