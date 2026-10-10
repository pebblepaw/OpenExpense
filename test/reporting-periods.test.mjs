import test from 'node:test';
import assert from 'node:assert/strict';
import { reportingPeriodIndices } from '../src/reporting-periods.mjs';

test('ruler only includes available months, quarters and years, anchored to the latest available month',()=>{
  const keys = ['2026-01','2026-02','2026-03','2026-04','2026-07','2026-10'];
  assert.equal(reportingPeriodIndices(keys,'Month').length,6);
  assert.deepEqual(reportingPeriodIndices(keys,'Quarter').map(row=>[row.label,row.month]),[['Q1','2026-03'],['Q2','2026-04'],['Q3','2026-07'],['Q4','2026-10']]);
  assert.deepEqual(reportingPeriodIndices(keys,'Year').map(row=>[row.label,row.month]),[['2026','2026-10']]);
  assert.deepEqual(reportingPeriodIndices(['2026-07','2026-09'],'Quarter').map(row=>row.label),['Q3']);
  assert.deepEqual(reportingPeriodIndices([],'Year'),[]);
});

test('multi-year ruler distinguishes quarters and returns stable chronological indices',()=>{
  const keys = ['2026-05','2025-12','2026-01','2026-05'];
  assert.deepEqual(reportingPeriodIndices(keys,'Quarter').map(row=>[row.label,row.month]),[['Q4 2025','2025-12'],['Q1 2026','2026-01'],['Q2 2026','2026-05']]);
  assert.deepEqual(reportingPeriodIndices(keys,'Year').map(row=>[row.label,row.month]),[['2025','2025-12'],['2026','2026-05']]);
});
