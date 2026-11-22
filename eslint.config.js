import js from '@eslint/js';
import globals from 'globals';
// no-shadow: a local that hides module state or an import (#190). complexity: the ceiling is the
// worst function today (card() in src/app/cards.js), so it can only go down.
const rules = { 'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }], 'no-shadow': 'error', complexity: ['error', 65] };
export default [
  { ignores: ['dist/', 'backend/web/dist/', '.runtime/', 'backend/pb_data/', 'node_modules/'] },
  { ...js.configs.recommended, rules: { ...js.configs.recommended.rules, ...rules } },
  // Files other changes of the 20 Nov review are rewriting or moving still have hidden names;
  // each comes off this list once it is fixed.
  { files: ['backend/admin/odyle.js', 'src/card.js', 'tests/i18n.test.cjs', 'tests/integration.test.mjs', 'tests/live.test.cjs', 'tests/ui.test.mjs'], rules: { 'no-shadow': 'off' } },
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['tests/**', 'scripts/**', 'vite.config.js', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  { files: ['public/sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Browser checks also hand functions to the page (page.evaluate, addInitScript).
  { files: ['tests/ui.test.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
  // The PocketBase dashboard extension: main.js is concatenated into /_/extensions.js,
  // odyle.js is a module it imports; both use the dashboard's app, t, store and watch.
  { files: ['backend/admin/*.js'], languageOptions: { globals: { ...globals.browser, app: 'readonly', t: 'readonly', store: 'readonly', watch: 'readonly' } } },
  { files: ['backend/admin/main.js'], languageOptions: { sourceType: 'script' } },
];
