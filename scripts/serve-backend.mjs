import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const bin = resolve('.runtime', process.platform === 'win32' ? 'odyle.exe' : 'odyle');
try { process.loadEnvFile(resolve('.env.backend')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const child = spawn(bin, ['serve', '--http=127.0.0.1:8090', '--dir=backend/pb_data', '--publicDir=dist', '--origins=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://127.0.0.1:8090'], { stdio: 'inherit' });
child.on('error', () => { console.error('Build the backend first: npm run backend:build'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code; });
process.on('SIGINT', () => child.kill());
