import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

function run(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin });
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  p.on('exit', (code) => { console.log(`[${name}] exited with code ${code}`); if (code !== 0) process.exit(code ?? 1); });
  return p;
}

const server = run('api', process.execPath, ['server/index.js']);
const client = run('web', npm, ['run', 'dev']);

process.on('SIGINT', () => { server.kill(); client.kill(); process.exit(0); });
process.on('SIGTERM', () => { server.kill(); client.kill(); process.exit(0); });
