// Builds the backend (Go 1.27 or newer) into .runtime: odyle, the server, and odyle-test,
// the disposable test backend of the integration and browser checks (build tag odyletest).
// Both carry the dashboard of the last npm run build (dist), copied into backend/web/dist
// for go:embed; without one they serve --publicDir.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
const exe = process.platform === 'win32' ? '.exe' : '';
const embedded = resolve('backend', 'web', 'dist');
for (const name of readdirSync(embedded)) if (name !== '.gitkeep') rmSync(join(embedded, name), { recursive: true });
const built = existsSync(resolve('dist', 'index.html'));
if (built) cpSync(resolve('dist'), embedded, { recursive: true });
const build = (name, ...flags) => execFileSync('go', ['build', '-trimpath', ...flags, '-o', resolve('.runtime', name + exe), '.'], { cwd: resolve('backend'), stdio: 'inherit' });
build('odyle');
build('odyle-test', '-tags', 'odyletest');
console.log(`Built .runtime/odyle${exe} and .runtime/odyle-test${exe}` + (built ? ' with the dashboard of dist.' : ' without a dashboard (run npm run build first to build it in).'));
