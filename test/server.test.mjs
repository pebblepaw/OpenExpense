import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { load, payload, server } from '../src/server.mjs';
import { relationshipAccount } from '../src/config.mjs';

test('serves a favicon and returns a normal 404 for a missing static asset', async (context) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/favicon.svg`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await response.text(), /<svg/);
  const missing = await fetch(`http://127.0.0.1:${port}/missing.css`);
  assert.equal(missing.status, 404);
});

test('reports source gaps with human-readable account names', async (context) => {
  const sourceDirectory = process.cwd();
  const testDirectory = await mkdtemp(join(tmpdir(), 'money-server-test-'));
  const hasMaster = existsSync(join(sourceDirectory, 'master_transactions.xlsx'));

  if (hasMaster) {
    await copyFile(join(sourceDirectory, 'master_transactions.xlsx'), join(testDirectory, 'master_transactions.xlsx'));
    for (const directory of ['POSB:DBS Bank Statement', 'PayLah', 'Revolut', 'config']) {
      if (existsSync(join(sourceDirectory, directory))) {
        await symlink(join(sourceDirectory, directory), join(testDirectory, directory), 'dir');
      }
    }
  } else {
    await mkdir(join(testDirectory, 'POSB:DBS Bank Statement'), { recursive: true });
    await mkdir(join(testDirectory, 'PayLah'), { recursive: true });
    await mkdir(join(testDirectory, 'Revolut'), { recursive: true });
    await mkdir(join(testDirectory, 'config'), { recursive: true });
    await copyFile(join(sourceDirectory, 'test/fixtures/dbs-real-layout.csv'), join(testDirectory, 'POSB:DBS Bank Statement/test.csv'));
    await copyFile(join(sourceDirectory, 'test/fixtures/revolut-real-layout.csv'), join(testDirectory, 'Revolut/revolut.csv'));
    await copyFile(join(sourceDirectory, 'config/merchant_directory.csv'), join(testDirectory, 'config/merchant_directory.csv'));
  }

  process.chdir(testDirectory);
  context.after(async () => {
    process.chdir(sourceDirectory);
    await rm(testDirectory, { recursive: true, force: true });
  });
  await load();
  const data = payload();
  const gaps = data.sourceGaps;
  assert.ok(Array.isArray(gaps));
  assert.ok(Array.isArray(data.transactions));
  assert.equal(data.relationship.accountId, relationshipAccount.accountId);
});
