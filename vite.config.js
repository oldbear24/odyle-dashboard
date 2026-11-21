import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
// Built files keep their names across releases unless their own code changed (#185):
// - The version is a meta tag of the page (index.html is revalidated on every load), not a
//   constant of the entry, so a release that changes nothing else renames nothing.
// - The modules that both the first page and its lazy parts use sit in a shared chunk (and
//   the PocketBase SDK in its own), so the parts import that one instead of the entry, which
//   changes with nearly every release.
// - The service worker carries the build's name and its files, so each build installs a new
//   worker that keeps the files still in use and drops the others.
// - The page preloads the Latin fonts, which the browser would otherwise find only after the
//   style sheet (#186; main.js adds Latin Extended for Czech).
function odyleBuild() {
  // The modules a lazy part imports, found once the module graph is known (buildEnd); the
  // shared group takes those the entry imports too ($initial).
  const usedByParts = new Set();
  return {
    name: 'odyle-build',
    buildEnd() {
      const walk = id => { for (const next of this.getModuleInfo(id)?.importedIds || []) if (!usedByParts.has(next)) { usedByParts.add(next); walk(next); } };
      for (const id of this.getModuleIds()) if (this.getModuleInfo(id)?.dynamicImporters.length) walk(id);
    },
    usedByParts,
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const fonts = Object.keys(context.bundle || {}).filter(file => /\/(dm-sans|manrope)-latin-wght-normal-[\w-]+\.woff2$/.test(file)).sort();
        return [{ tag: 'meta', attrs: { name: 'odyle-version', content: version }, injectTo: 'head' },
          ...fonts.map(file => ({ tag: 'link', attrs: { rel: 'preload', href: './' + file, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' }))];
      },
    },
    generateBundle(options, bundle) {
      const files = Object.keys(bundle).filter(file => file.startsWith('assets/')).sort(), name = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const worker = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8'), stamped = worker.replace("const build = 'dev', built = null;", `const build = ${JSON.stringify(name)}, built = ${JSON.stringify(files)};`);
      if (stamped === worker) this.error('public/sw.js lost its build line');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: stamped });
    },
  };
}
// Fonts stay files, never data: URIs, which the content security policy (font-src 'self') blocks.
export default defineConfig(({ mode }) => {
  const policy = securityPolicy(loadEnv(mode, process.cwd(), 'VITE_').VITE_POCKETBASE_URL), build = odyleBuild();
  const code = id => !/\.css($|\?)/.test(id);
  return {
    base: './',
    build: {
      outDir: 'dist', assetsInlineLimit: file => (file.endsWith('.woff2') ? false : undefined),
      rolldownOptions: { output: { codeSplitting: { groups: [
        { name: 'pocketbase', test: id => /node_modules[\\/]pocketbase[\\/]/.test(id), tags: ['$initial'], priority: 2 },
        { name: 'shared', test: id => code(id) && build.usedByParts.has(id), tags: ['$initial'], priority: 1 },
      ] } } },
    },
    plugins: [build, ...(policy ? [{ name: 'odyle-security-policy', apply: 'build', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }] }] : [])],
  };
});
