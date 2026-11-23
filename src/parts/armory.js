// The armory's pages (armory.js) and its comparison of two characters (compare.js) with their
// styles: loaded with the first of them (app/parts.js, lazy.js), after the dashboard's own styles.
import '../armory.css';
import '../armorydetail.css';
import '../compare.css';
import '../armoryhistory.css';
export * from '../armory.js';
export * from '../compare.js';
export { bindProgress } from '../armoryhistory.js';
