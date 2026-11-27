// What the rest of the dashboard needs of builds without loading them (builds.js loads with their
// first page, app/builds.js): their paths, which page a path asks for and their titles.
// Pages: /builds (the account's builds), /builds/<id>[/<tab>] (one of them) and
// /builds/shared/<code>[/<tab>] (a shared build, for anyone with its link).
import { t } from './i18n.js';

// A build page's tabs after its first one (gear and stats), as their paths name them.
export const buildTabs = ['skills', 'daevanion', 'compare'];
const tabSource = String.raw`(?:\/(?:skills|daevanion|compare))?`;
// PocketBase's record ids are 15 lower-case letters and digits; share codes 16 of the code alphabet
// (backend/odyle/builds.go).
export const buildsRoute = new RegExp(String.raw`^\/builds(?:\/(?:shared\/[A-Z2-9]{16}|[a-z0-9]{15})${tabSource})?$`);
export const buildsPath = '/builds';
export const buildPath = (id, tab = '') => `/builds/${id}${buildTabs.includes(tab) ? '/' + tab : ''}`;
export const sharedPath = (code, tab = '') => `/builds/shared/${code}${buildTabs.includes(tab) ? '/' + tab : ''}`;

// What a path asks for: { list } (the account's builds), { id, tab } (one of them) or { code, tab }
// (a shared build).
export function buildTarget(path) {
  const parts = path.split('/').slice(2);
  if (parts[0] === 'shared' && parts[1]) return { code: parts[1], tab: buildTabs.includes(parts[2]) ? parts[2] : '' };
  if (parts[0]) return { id: parts[0], tab: buildTabs.includes(parts[1]) ? parts[1] : '' };
  return { list: true };
}

// The page's title in the tab, as the backend names it (backend/odyle/pages.go): the list, or a
// build by its name and class once it is fetched.
export function buildTitle(build, path = '') {
  if (build?.name) return t('{name} · {class} build · Odyle', { name: build.name, class: build.class });
  if (path === buildsPath) return t('Your builds · Odyle');
  return /^\/builds\/shared\//.test(path) ? t('A shared build · Odyle') : t('A build · Odyle');
}
