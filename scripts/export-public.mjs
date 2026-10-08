// Export reviewed, committed source files without copying private Git history.
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/export-public.mjs /path/to/empty-directory');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const output = resolve(destination);
if (output === root || output.startsWith(root + '/')) throw new Error('Choose an empty directory outside the private checkout.');
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('Destination must be empty; existing files are never overwritten.');
const exact = new Set([
  '.env.example', '.gitignore', '.impeccable.md', '.mise.toml', 'LICENSE', 'README.md',
  'package.json', 'package-lock.json', '.github/workflows/pages.yml',
  'config/defaults.yaml', 'config/config.yaml.example',
  'config/merchant_rules.csv', 'config/merchant_directory.csv',
  'docs/architecture.md', 'docs/assets/openexpense-banner.png', 'docs/assets/banner.md'
]);
const trees = ['src/', 'frontend/', 'scripts/', 'skills/', 'test/'];
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { cwd: root }).toString().split('\0')
  .filter(file => file && (exact.has(file) || trees.some(prefix => file.startsWith(prefix))));
for (const file of files) {
  const target = resolve(output, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 }));
}
execFileSync(process.execPath, [resolve(root, 'scripts/check-public.mjs'), output], { stdio: 'inherit' });
console.log(`Exported ${files.length} reviewed source files. No Git history or ignored data was copied.`);
