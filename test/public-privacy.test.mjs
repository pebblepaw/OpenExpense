import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadMerchantDirectory } from '../src/merchant-directory.mjs';

test('missing private merchant directory is supported, but public exports must reject it',async context=>{
  const temporary=await mkdtemp(join(tmpdir(),'openexpense-private-merchant-test-'));
  context.after(()=>rm(temporary,{recursive:true,force:true}));
  const directory=join(temporary,'config','merchant_directory.csv');
  assert.equal((await loadMerchantDirectory(directory)).size,0);
  const guard=resolve('scripts/check-public.mjs');
  assert.equal(spawnSync(process.execPath,[guard,temporary],{encoding:'utf8'}).status,0);
  await mkdir(join(temporary,'config'));
  await writeFile(directory,'merchantKey,category\nFICTIONAL MERCHANT,Healthcare\n');
  const rejected=spawnSync(process.execPath,[guard,temporary],{encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/merchant_directory\.csv: private-file pattern/);
  const exporter=await readFile('scripts/export-public.mjs','utf8');
  assert.ok(!exporter.includes("'config/merchant_directory.csv'"));
});
