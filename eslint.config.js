import js from '@eslint/js';
import globals from 'globals';
const rules = { 'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] };
export default [
  { ignores: ['dist/', '.runtime/', 'backend/pb_data/', 'node_modules/'] },
  { ...js.configs.recommended, rules: { ...js.configs.recommended.rules, ...rules } },
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.browser, __APP_VERSION__: 'readonly' } } },
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
