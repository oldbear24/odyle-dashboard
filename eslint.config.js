import js from '@eslint/js';
import globals from 'globals';
// PocketBase runs pb_hooks and pb_migrations in its own JavaScript VM (goja) with
// these globals; see https://pocketbase.io/jsvm/.
const pocketbase = Object.fromEntries(['__hooks', '$app', '$apis', '$os', '$security', '$http', '$filesystem', '$dbx', 'routerAdd', 'routerUse', 'cronAdd', 'onBootstrap', 'onRecordDelete', 'onRealtimeSubscribeRequest', 'onRealtimeMessageSend', 'migrate', 'Record', 'Collection', 'SubscriptionMessage', 'BadRequestError', 'ForbiddenError', 'NotFoundError', 'TextField', 'NumberField', 'BoolField', 'DateField', 'SelectField', 'RelationField', 'FileField', 'JSONField', 'toString', 'require', 'module', 'console'].map(name => [name, 'readonly']));
const rules = { 'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] };
export default [
  { ignores: ['dist/', '.runtime/', 'backend/pb_data/', 'node_modules/', 'backend/pb_hooks/types.d.ts'] },
  { ...js.configs.recommended, rules: { ...js.configs.recommended.rules, ...rules } },
  { files: ['src/**/*.js'], languageOptions: { globals: { ...globals.browser, __APP_VERSION__: 'readonly' } } },
  { files: ['tests/**', 'scripts/**', 'vite.config.js', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  // Browser checks also hand functions to the page (page.evaluate, addInitScript).
  { files: ['tests/ui.test.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
  { files: ['backend/pb_hooks/**/*.{js,cjs}', 'backend/pb_migrations/*.js'], ignores: ['backend/pb_hooks/admin/**'], languageOptions: { sourceType: 'script', globals: pocketbase } },
  // The PocketBase dashboard extension: main.js is concatenated into /_/extensions.js,
  // odyle.js is a module it imports; both use the dashboard's app, t, store and watch.
  { files: ['backend/pb_hooks/admin/*.js'], languageOptions: { globals: { ...globals.browser, app: 'readonly', t: 'readonly', store: 'readonly', watch: 'readonly' } } },
  { files: ['backend/pb_hooks/admin/main.js'], languageOptions: { sourceType: 'script' } },
];
