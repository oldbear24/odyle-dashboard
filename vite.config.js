import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
// The footer shows the package version, the same one the releases are numbered after.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({ base: './', build: { outDir: 'dist' }, define: { __APP_VERSION__: JSON.stringify(version) } });
