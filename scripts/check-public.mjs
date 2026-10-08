import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(process.argv[2] ?? 'frontend/dist-demo');
const forbiddenFiles = /(?:master_transactions|config\.ya?ml$|\.xlsx$|\.pdf$|\.ndjson$|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:PayLah|Revolut|POSB:DBS Bank Statement|private-data)(?:\/|$))/;
const failures = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory,entry.name);
    const name = relative(root,file);
    if (forbiddenFiles.test(name) && name !== 'frontend/.env.demo' && name !== '.env.example') failures.push(name+': private-file pattern');
    if (entry.isDirectory()) { if (entry.name !== '.git' && entry.name !== 'node_modules') await scan(file); continue; }
    if (!/\.(?:js|mjs|cjs|ts|tsx|html|json|csv|txt|md|ya?ml)$/.test(file)) continue;
    const text = await readFile(file,'utf8');
    if (/\b(?!0000-0000-0000-0000)\d{4}-\d{4}-\d{4}-\d{4}\b/.test(text)) failures.push(name+': non-synthetic full card reference');
    if (/\/(?:Users|home)\/[^\s"'<>]+/.test(text)) failures.push(name+': private filesystem path');
  }
}
await scan(root);
if (failures.length) { console.error(failures.join('\n'));process.exitCode=1; }
else console.log('Public artifact privacy check passed.');
