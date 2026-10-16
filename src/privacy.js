// The privacy notice in the app (#39): docs/privacy.md, bundled with the build, as a page
// (#/privacy) linked from the help, the welcome page and the footer, with where to ask or
// report a problem. The notice is written in English; Czech readers are told so.
import { t, language } from './i18n.js';
import { escape as esc } from './model.js';
import { icon } from './icons.js';

const docs = 'https://github.com/oldbear24/odyle-dashboard/blob/main/docs/';
export const projectLinks = { dashboard: 'https://github.com/oldbear24/odyle-dashboard', windows: 'https://github.com/oldbear24/odyle-windows', issues: 'https://github.com/oldbear24/odyle-dashboard/issues' };

// Where a link of the notice leads: web addresses as they are, other documents of the
// repository on GitHub, and an anchor within the notice there too.
export function noticeHref(href) {
  if (/^https:\/\//.test(href)) return href;
  if (href.startsWith('#')) return docs + 'privacy.md' + href;
  if (/^[\w./-]+\.md(#[\w-]+)?$/.test(href)) return docs + href.replace(/^\.\//, '');
  return '';
}

// Inline Markdown of the notice: `code`, **bold** and [links](…); everything else is text.
export function inline(text) {
  const codes = [];
  // Code is set aside (private-use marks), so its text keeps its stars and brackets.
  let html = esc(text).replace(/`([^`]+)`/g, (_, code) => `${codes.push(code) - 1}`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
    const target = noticeHref(href.replace(/&amp;/g, '&'));
    return target ? `<a href="${esc(target)}" target="_blank" rel="noopener">${label}</a>` : label;
  });
  return html.replace(/(\d+)/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

// The notice's blocks: headings, lists and paragraphs (its own title is the page's).
export function noticeHtml(markdown) {
  return markdown.replace(/\r\n/g, '\n').split(/\n{2,}/).map(block => block.trim()).filter(Boolean).map(block => {
    if (block.startsWith('# ')) return '';
    if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
    if (/^[-*] /.test(block)) return `<ul>${block.split('\n').map(line => `<li>${inline(line.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`;
    return `<p>${inline(block.replace(/\n/g, ' '))}</p>`;
  }).join('');
}

export function privacyPage(markdown) {
  const english = language() === 'cs' ? `<p class="privacy-language">${t('The notice is in English.')}</p>` : '';
  const link = (href, label) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  return `<main class="dashboard privacy-page"><section class="heading"><div><div class="eyebrow"><span class="tiny-diamond"></span> ${t('YOUR DATA')}</div><h1>${t('Privacy')}<span class="mint">.</span></h1><p>${t('What Odyle keeps, where it goes and how long it stays.')}</p></div></section>`
    + `<section class="setup-card privacy-help"><h2>${icon('info')} ${t('Questions or problems?')}</h2><p>${t('Odyle is open source. Report a problem or ask a question where everyone can see it, or read the code yourself:')}</p><p class="privacy-links">${link(projectLinks.issues, t('Report a problem or ask'))} · ${link(projectLinks.dashboard, t('Dashboard and server'))} · ${link(projectLinks.windows, t('Windows app'))}</p><p>${t('Account & data downloads everything stored for your account and deletes it.')}</p></section>`
    + `${english}<article class="privacy-text">${noticeHtml(markdown)}</article></main>`;
}
