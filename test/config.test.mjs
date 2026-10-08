import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categories,
  knownIncomePatterns,
  paths,
  transferMatching
} from '../src/config.mjs';

test('uses the canonical workbook and exact requested categories', () => {
  assert.equal(paths.workbook, './master_transactions.xlsx');
  assert.deepEqual(categories, [
    'Food & Dining',
    'Groceries',
    'Transport',
    'Shopping',
    'Entertainment',
    'Travel',
    'Bills',
    'Gym',
    'Education & Work',
    'Healthcare',
    'Cash',
    'Transfer to Relationship Account',
    'Transfers to People',
    'Unclassified Transfers',
    'Pending PayLah detail',
    'Fees',
    'Uncategorized'
  ]);
});

test('includes the PayLah source directory', () => {
  assert.equal(paths.sources.paylah, './PayLah');
});

test('configures all known income patterns', () => {
  assert.ok(Array.isArray(knownIncomePatterns) && knownIncomePatterns.length > 0);
  assert.ok(knownIncomePatterns.includes('GOVTECH'));
});

test('configures transfer matching defaults', () => {
  assert.equal(transferMatching.maxCalendarDays, 3);
  assert.equal(transferMatching.amountToleranceSgd, 0.01);
});

test('includes DBS and Revolut source directories', () => {
  assert.equal(paths.sources.dbs, './POSB:DBS Bank Statement');
  assert.equal(paths.sources.revolut, './Revolut');
});
