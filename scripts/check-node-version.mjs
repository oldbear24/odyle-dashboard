// Fails when the Dockerfile's Node major differs from .node-version (CI reads that file for
// setup-node; the Dockerfile cannot) or from package.json's engines.node.
import { readFileSync } from 'node:fs';

const wanted = readFileSync('.node-version', 'utf8').trim();
const image = readFileSync('Dockerfile', 'utf8').match(/^FROM\s+(?:--\S+\s+)*node:(\d+)[\w.-]*/m);
const engines = JSON.parse(readFileSync('package.json', 'utf8')).engines?.node;
const problems = [];
if (!/^\d+$/.test(wanted)) problems.push(`.node-version must hold only the major, found "${wanted}"`);
if (!image) problems.push('Dockerfile has no FROM node:<major> line');
else if (image[1] !== wanted) problems.push(`Dockerfile uses node:${image[1]} but .node-version says ${wanted}`);
if (engines !== `>=${wanted}`) problems.push(`package.json engines.node is "${engines}", expected ">=${wanted}"`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Node ${wanted}: .node-version, Dockerfile and package.json agree`);