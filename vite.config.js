import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
// The footer shows the package version, the same one the releases are numbered after.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Fonts stay files, never data: URIs, which the content security policy (font-src 'self') blocks.
export default defineConfig({ base: './', build: { outDir: 'dist', assetsInlineLimit: file => (file.endsWith('.woff2') ? false : undefined) }, define: { __APP_VERSION__: JSON.stringify(version) } });
