// English is the source language. t() looks the English text up in the active
// dictionary and falls back to it, so a missing translation shows English, never a
// key. {name} placeholders are filled from params; callers escape anything a player
// typed before it goes into HTML. Backend error messages are English and go through
// the same lookup. Dictionaries load when their language is first used, so English
// visitors never download them.
const loaders = { cs: () => import('./locales/cs.js') }, dictionaries = {};
export const languages = [{ code: 'en', name: 'English', locale: 'en-GB' }, { code: 'cs', name: 'Čeština', locale: 'cs-CZ' }];
let current = 'en';
// A saved choice wins; otherwise the browser's first supported language, else English.
export function detect(saved, preferred = []) {
  if (languages.some(l => l.code === saved)) return saved;
  for (const tag of preferred) { const found = languages.find(l => String(tag).toLowerCase().split('-')[0] === l.code); if (found) return found.code; }
  return 'en';
}
export async function useLanguage(code) {
  const next = languages.some(l => l.code === code) ? code : 'en';
  if (loaders[next] && !dictionaries[next]) dictionaries[next] = (await loaders[next]()).default;
  current = next; return current;
}
export const language = () => current;
export const locale = () => languages.find(l => l.code === current).locale;
const fill = (text, params) => params ? text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : text;
export function t(text, params) {
  const found = dictionaries[current]?.[text];
  return fill(typeof found === 'string' ? found : text, params);
}
// Plurals: English has one and other, Czech one (1), few (2–4) and other. The
// dictionary keys a plural by its English forms joined with '|'; {n} is the count.
export function tn(count, one, other, params) {
  const found = dictionaries[current]?.[one + '|' + other], forms = Array.isArray(found) ? found : [one, other];
  const index = current === 'cs' ? (count === 1 ? 0 : count >= 2 && count <= 4 ? 1 : 2) : count === 1 ? 0 : 1;
  return fill(forms[Math.min(index, forms.length - 1)], { n: count.toLocaleString(locale()), ...params });
}
