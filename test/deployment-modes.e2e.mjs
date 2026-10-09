import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Read-only local check: never refresh, retag or write the user's ledger.
test('local build always uses real data, has no demo fallback, and preserves the ruler animation', {skip: !process.env.MONEY_SITE_URL}, async context => {
  const url = process.env.MONEY_SITE_URL;
  const response = await fetch(`${url}/api/data`);
  assert.equal(response.status,200);
  const data = await response.json();
  assert.ok(data.transactions.length>0);
  assert.ok(data.transactions.every(row=>!row.id.startsWith('demo-')));
  const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  context.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  await page.goto(url);
  await page.locator('.metric-card').first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Demo',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'My data',exact:true}).count(),0);
  assert.ok(!(await page.locator('.sync-strip').innerText()).includes('Fictional data'));
  await page.mouse.move(0,0);
  await page.waitForFunction(()=>document.querySelector('.month-ruler').getBoundingClientRect().height===22);
  await page.locator('.month-ruler').hover();
  await page.waitForFunction(()=>document.querySelector('.month-ruler').getBoundingClientRect().height===48);
  await page.locator('.month-tick').last().click();
  const bounds = await page.evaluate(()=>({ruler:document.querySelector('.month-ruler').getBoundingClientRect().bottom,sync:document.querySelector('.sync-strip').getBoundingClientRect().bottom,stage:document.querySelector('.dashboard-stage').getBoundingClientRect().top}));
  assert.ok(bounds.ruler<=bounds.stage && bounds.sync<=bounds.stage);
  await page.mouse.move(0,0);
  await page.waitForFunction(()=>document.querySelector('.month-ruler').getBoundingClientRect().height===22);
  await page.route('**/api/data',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Local API unavailable for this read-only test'})}));
  await page.reload();
  await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/demo/i}).count(),0);
  assert.equal(await page.locator('.metric-card').count(),0,'failed real-data loading must never silently substitute demo data');
});
