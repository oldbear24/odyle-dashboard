// Builds the backend (Go 1.27 or newer) into .runtime: odyle, the server, and odyle-test,
// the disposable test backend of the integration and browser checks (build tag odyletest).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const exe = process.platform === 'win32' ? '.exe' : '';
const build = (name, ...flags) => execFileSync('go', ['build', '-trimpath', ...flags, '-o', resolve('.runtime', name + exe), '.'], { cwd: resolve('backend'), stdio: 'inherit' });
build('odyle');
build('odyle-test', '-tags', 'odyletest');
console.log(`Built .runtime/odyle${exe} and .runtime/odyle-test${exe}.`);
