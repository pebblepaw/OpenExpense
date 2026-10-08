import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Read-only check against the running site; never edits the user's workbook.
test('viewport drawers, clean amounts and Spending / Income category charts', { skip: !process.env.MONEY_SITE_URL }, async context => {
  const url = process.env.MONEY_SITE_URL;
  const data = await (await fetch(`${url}/api/data`)).json();
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('.metric-card').first().waitFor();
  await page.getByRole('button', { name: 'Year', exact: true }).click();
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  assert.equal(await page.locator('tbody td:nth-child(5) span.absolute').count(), 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.getByRole('button', { name: 'Import statement', exact: true }).click();
    await page.waitForFunction(() => {
      const rect = document.querySelector('.budget-drawer-open')?.getBoundingClientRect();
      return rect && Math.abs(rect.right - (innerWidth - 12)) < 1;
    });
    const drawer = await page.locator('.budget-drawer-open').boundingBox();
    assert.ok(drawer.x >= 0 && drawer.x + drawer.width <= width);
    assert.equal(await page.locator('body > .transaction-drawer-layer .budget-drawer-open').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.budget-drawer-open').length === 0);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  assert.equal(await page.locator('.category-index').getByRole('button', { name: 'Savings', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'See all charts', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.category-trend .recharts-bar-rectangle path[d]').length > 0);
  assert.ok(!(await page.locator('.category-detail .chart-legend').innerText()).includes('Receipts'));
  const ticks = await page.locator('.category-trend .recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents();
  assert.ok(ticks.length > 0 && ticks.every(tick => !/[-−]/.test(tick)));
  await page.locator('.category-index').getByRole('button', { name: 'Income', exact: true }).click();
  const recognized = data.transactions.filter(row => row.role === 'income' && row.amountSgd > 0 && row.accountId !== data.relationship.accountId);
  const sources = [...new Set(recognized.map(row => row.incomeSource))].sort();
  const displayed = await page.locator('.category-index-row strong').allTextContents();
  assert.deepEqual(displayed.sort(), sources);
  const format = value => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 }).format(value);
  assert.ok((await page.locator('.category-detail-heading h2').innerText()).includes(format(data.metrics.months.reduce((sum, row) => sum + row.netIncomeSgd, 0))));
  for (const source of sources) {
    await page.locator('.category-index-row').filter({ has: page.locator('strong', { hasText: source }) }).click();
    assert.equal(await page.locator('.category-transaction-link').count(), Math.min(60, recognized.filter(row => row.incomeSource === source).length));
    assert.ok((await page.locator('.category-transaction-link strong').allTextContents()).every(amount => amount.startsWith('+')));
  }
  await page.locator('.category-index-row').filter({ hasText: 'Salary' }).click();
  assert.ok((await page.locator('.category-transactions').innerText()).includes('Payments received'));
  assert.ok((await page.locator('.category-transaction-link strong').allTextContents()).every(amount => amount.startsWith('+')));
  await page.getByRole('button', { name: 'Single chart', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.category-trend .recharts-line-curve[d]').length === 1);
  await page.locator('.category-transaction-link').first().click();
  assert.equal(await page.locator('.transaction-row-focused').count(), 1);
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await page.locator('.category-index').getByRole('button', { name: 'Income', exact: true }).click();
  await page.getByRole('button', { name: 'Relationship account', exact: true }).click();
  assert.match(await page.locator('.category-index').innerText(), /Account contributions/i);
  assert.ok((await page.locator('.category-index-row strong').allTextContents()).every(name => name.includes('contributions')));
  assert.deepEqual(errors, []);
});
