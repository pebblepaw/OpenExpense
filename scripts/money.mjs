import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd: resolve('.') });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)));
  });
}
if (!existsSync('frontend/node_modules/vite')) await run('npm', ['install', '--prefix', 'frontend']);
await run('npm', ['run', 'build', '--prefix', 'frontend']);
const child = spawn(process.execPath, ['src/server.mjs'], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
