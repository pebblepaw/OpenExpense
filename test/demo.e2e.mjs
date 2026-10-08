import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('synthetic Pages site works under a project path, never calls an API, and persists only demo edits', async context => {
  const temporary = await mkdtemp(join(tmpdir(),'openexpense-demo-test-'));
  context.after(() => rm(temporary,{recursive:true,force:true}));
  const fixture = join(temporary,'demo.mjs');
  await build({entryPoints:['frontend/src/lib/demo-data.ts'],bundle:true,platform:'node',format:'esm',outfile:fixture});
  const { buildDemoData } = await import(pathToFileURL(fixture));
  const data = buildDemoData();
  assert.deepEqual(buildDemoData(),data);
  assert.ok(data.transactions.length > 350);
  assert.ok(data.accounts.every(account => account.accountId.startsWith('DEMO-')));
  assert.ok(data.transactions.every(row => row.id.startsWith('demo-')));
  const round=value => Math.round(value*100)/100;
  for (const month of data.metrics.months) {
    assert.equal(round(month.grossSpendSgd-month.reimbursementsSgd),month.netPersonalSpendSgd);
    assert.equal(round(month.netIncomeSgd-month.netPersonalSpendSgd),month.savedSgd);
  }
  const root=resolve('frontend/dist-demo');
  assert.ok(existsSync(join(root,'index.html')),'Build the demo first');
  const apiCalls=[];
  const server=createServer(async(request,response) => {
    if (request.url.includes('/api/')) { apiCalls.push(request.url);response.writeHead(500);response.end('Demo must never request an API');return; }
    try {
      const relative=new URL(request.url,'http://localhost').pathname.replace(/^\/OpenExpense\//,'');
      const file=resolve(root,relative || 'index.html');
      if (!file.startsWith(root+'/')) throw new Error('Invalid path');
      response.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch { response.writeHead(404);response.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const executablePath=process.env.BROWSER_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const browser=await chromium.launch({headless:true,executablePath});
  context.after(() => browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[];page.on('pageerror',error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/OpenExpense/`);
  await page.locator('.metric-card').first().waitFor();
  assert.match(await page.locator('.demo-label').innerText(),/Synthetic demo/);
  assert.equal(await page.getByRole('button',{name:'My data',exact:true}).count(),0);
  await page.waitForFunction(() => document.querySelectorAll('.flow-chart .recharts-area-curve[d]').length===3);
  await page.getByRole('button',{name:'Transactions',exact:true}).click();
  const row=page.locator('tbody tr').filter({has:page.locator('select')}).first();
  const id=(await row.getAttribute('id')).replace('transaction-','');
  const old=await row.locator('select').first().inputValue();
  const next=old==='Shopping' ? 'Food & Dining' : 'Shopping';
  await row.locator('select').first().selectOption(next);
  await page.waitForFunction(({id,next}) => JSON.parse(localStorage.getItem('openexpense-synthetic-edits-v1') || '{}').transactions?.[id]?.manualCategory===next,{id,next});
  await page.reload();
  await page.locator('.metric-card').first().waitFor();
  await page.getByRole('button',{name:'Transactions',exact:true}).click();
  assert.equal(await page.locator(`[id="transaction-${id}"] select`).first().inputValue(),next);
  await page.getByRole('button',{name:'Categories',exact:true}).click();
  await page.locator('.category-index').getByRole('button',{name:'Income',exact:true}).click();
  assert.ok((await page.locator('.category-index-row strong').allTextContents()).includes('Salary'));
  await page.getByRole('button',{name:'Relationship account',exact:true}).click();
  assert.match(await page.locator('.category-index').innerText(),/Account contributions/i);
  await page.getByRole('button',{name:'Transactions',exact:true}).click();
  await page.getByRole('button',{name:'Import statement',exact:true}).click();
  await page.getByRole('button',{name:'Reset demo data',exact:true}).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('openexpense-synthetic-edits-v1')),null);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),390);
  assert.deepEqual(apiCalls,[]);
  assert.deepEqual(errors,[]);
});
