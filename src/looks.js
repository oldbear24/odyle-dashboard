// The look an account wears from the slot machine (slots.js, which loads with its page): its
// name's colour and badge and its portrait frame, as rooms show them next to its name.
import { escape as esc } from './model.js';

// Only values of the server's catalog shape reach a style attribute.
const safeColor = value => /^#[0-9a-f]{6}$/i.test(value || '') || /^linear-gradient\(\d+deg(,#[0-9a-f]{6})+\)$/i.test(value || '') ? value : '';
export const colorStyle = value => !safeColor(value) ? '' : value.startsWith('linear-gradient') ? `background:${value};-webkit-background-clip:text;background-clip:text;color:transparent` : `color:${value}`;
export const frameClass = look => /^[a-z]+$/.test(look?.frame || '') ? ` frame-${look.frame}` : '';
export function lookName(name, look) {
  const style = colorStyle(look?.color), badge = look?.badge && look.badge.length <= 8 ? `<span class="look-badge" aria-hidden="true">${esc(look.badge)}</span>` : '';
  return `${style ? `<span class="look-name" style="${style}">${esc(name)}</span>` : esc(name)}${badge}`;
}
