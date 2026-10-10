import assert from 'node:assert/strict';
import { reportingPeriodIndices } from '../src/reporting-periods.mjs';

export async function checkPeriodControls(page,months) {
  assert.equal(await page.locator('.sync-strip,.partial-note').count(),0);
  const widths = [];
  for (const period of ['Month','Quarter','Year']) {
    await page.getByRole('button',{name:period,exact:true}).click();
    const indices = reportingPeriodIndices(months,period);
    assert.equal(await page.locator('.month-tick').count(),indices.length);
    widths.push((await page.locator('.month-ruler').boundingBox()).width);
    assert.equal(await page.locator('.month-tick[aria-pressed="true"]').count(),1);
    await page.locator('.month-ruler').hover();
    await page.waitForFunction(()=>document.querySelector('.month-ruler').getBoundingClientRect().height===48);
    await page.locator('.month-tick').first().click();
    assert.equal(await page.locator('.month-tick').first().getAttribute('aria-pressed'),'true');
    const bottom = await page.locator('.month-ruler').evaluate(el=>el.getBoundingClientRect().bottom);
    const stage = await page.locator('.dashboard-stage').evaluate(el=>el.getBoundingClientRect().top);
    assert.ok(bottom<=stage,'expanded ruler must stay above the charts');
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>document.querySelector('.month-ruler').getBoundingClientRect().height===22);
  }
  assert.ok(widths[0]>widths[1] && widths[1]>widths[2],'quarter/year ruler must physically shrink');
  const chartSwitch=page.locator('.chart-header .analysis-switch');
  const chipWidths=[];
  for (const mode of ['Flow','Balance','Saved','Categories']) {
    await chartSwitch.getByRole('button',{name:mode,exact:true}).click();
    chipWidths.push((await chartSwitch.boundingBox()).width);
    const children=await chartSwitch.locator('button').evaluateAll(items=>items.reduce((sum,item)=>sum+item.getBoundingClientRect().width,0));
    assert.ok(chipWidths.at(-1)-children<16,'chart switch must not stretch beyond its buttons');
  }
  assert.ok(Math.max(...chipWidths)-Math.min(...chipWidths)<1,'chart switch width must not change with its description');
  await chartSwitch.getByRole('button',{name:'Flow',exact:true}).click();
  await page.getByRole('button',{name:'Month',exact:true}).click();
  await page.locator('.month-tick').last().click();
  await page.mouse.move(0,0);
}
