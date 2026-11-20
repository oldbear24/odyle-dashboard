import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
// The footer shows the package version, the same one the releases are numbered after.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// The backend sends the dashboard it serves with a content security policy
// (backend/odyle/register.go). A dashboard built for another host (VITE_POCKETBASE_URL) is
// served by a static host that sends none, so its page carries the same policy, with the
// backend's origin allowed for the API, realtime and images. frame-ancestors only works as a
// header; the static host should send it.
function securityPolicy(backend) {
  if (!backend) return null;
  const origin = new URL(backend).origin;
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' ${origin}; connect-src 'self' ${origin}; frame-src https://aion2.th.gl; base-uri 'self'; form-action 'self'; object-src 'none'`;
}
// Fonts stay files, never data: URIs, which the content security policy (font-src 'self') blocks.
export default defineConfig(({ mode }) => {
  const policy = securityPolicy(loadEnv(mode, process.cwd(), 'VITE_').VITE_POCKETBASE_URL);
  return {
    base: './',
    build: { outDir: 'dist', assetsInlineLimit: file => (file.endsWith('.woff2') ? false : undefined) },
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: policy ? [{ name: 'odyle-security-policy', apply: 'build', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }] }] : [],
  };
});
