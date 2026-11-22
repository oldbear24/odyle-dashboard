import js from '@eslint/js';
import globals from 'globals';
// no-shadow: a local that hides module state or an import (#190). complexity: the ceiling is the
// worst function today (card() in src/app/cards.js), so it can only go down.
const rules = { 'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }], 'no-shadow': 'error', complexity: ['error', 65] };
export default [
  { ignores: ['dist/', 'backend/web/dist/', '.runtime/', 'backend/pb_data/', 'node_modules/'] },
  { ...js.configs.recommended, rules: { ...js.configs.recommended.rules, ...rules } },
  // no-shadow guards the dashboard (src/). The tests reuse names such as before, resolve and room in
  // nested scopes on purpose, and the PocketBase admin extension keeps a page's own days, clock and
  // filters beside the module-wide ones (10 cases), so the rule is off for both.
  { files: ['tests/**', 'backend/admin/**'], rules: { 'no-shadow': 'off' } },
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['tests/**', 'scripts/**', 'vite.config.js', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  { files: ['public/sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Browser checks also hand functions to the page (page.evaluate, addInitScript).
  { files: ['tests/ui.test.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  // The PocketBase dashboard extension: main.js is concatenated into /_/extensions.js,
  // odyle.js is a module it imports; both use the dashboard's app, t, store and watch.
  { files: ['backend/admin/*.js'], languageOptions: { globals: { ...globals.browser, app: 'readonly', t: 'readonly', store: 'readonly', watch: 'readonly' } } },
  { files: ['backend/admin/main.js'], languageOptions: { sourceType: 'script' } },
];
