import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTransactions } from '../src/classify.mjs';
import { categorySubcategories, settings } from '../src/config.mjs';
import { resolveAutomaticSubcategory as resolve } from '../src/subcategories.mjs';
const resolveAutomaticSubcategory = options => resolve({...options,definitions:settings.categories});

const tx = (id, amountSgd, overrides = {}) => ({
  id, descriptionRaw: 'Some merchant', amountSgd, direction: amountSgd < 0 ? 'outflow' : 'inflow',
  manualCategory: null, manualSubcategory: null, manualRole: null, ...overrides
});

test('food and shopping amount boundaries are inclusive at the specified thresholds', async () => {
  const rows = [
    tx('food-19.99', -19.99, { manualCategory: 'Food & Dining' }),
    tx('food-20', -20, { manualCategory: 'Food & Dining' }),
    tx('food-49.99', -49.99, { manualCategory: 'Food & Dining' }),
    tx('food-50', -50, { manualCategory: 'Food & Dining' }),
    tx('shop-19.99', -19.99, { manualCategory: 'Shopping' }),
    tx('shop-20', -20, { manualCategory: 'Shopping' }),
    tx('shop-49.99', -49.99, { manualCategory: 'Shopping' }),
    tx('shop-50', -50, { manualCategory: 'Shopping' })
  ];
  const result = await classifyTransactions(rows, { rules: [] });
  assert.deepEqual(result.map(({ subcategory }) => subcategory), [
    'Other meals (<$20)', 'Big meals ($20–$49.99)', 'Big meals ($20–$49.99)', 'Really big meals ($50+)',
    'Other purchases (<$50)', 'Other purchases (<$50)', 'Other purchases (<$50)', 'Big purchases ($50+)'
  ]);
});

test('manual category chooses the amount band and manual subcategory remains authoritative', async () => {
  const result = await classifyTransactions([
    tx('manual-category', -60, { categoryAuto: 'Shopping', manualCategory: 'Food & Dining', subcategoryAuto: 'Restaurant' }),
    tx('manual-subcategory', -60, { manualCategory: 'Food & Dining', manualSubcategory: 'Celebration' })
  ], { rules: [] });
  assert.equal(result[0].category, 'Food & Dining');
  assert.equal(result[0].subcategory, 'Really big meals ($50+)');
  assert.equal(result[1].subcategory, 'Celebration');
});

test('non-band merchant subcategories and conservative transport fallback are retained', () => {
  assert.equal(resolveAutomaticSubcategory({ category: 'Groceries', amountSgd: -4, suggestedSubcategory: 'Supermarket' }), 'Supermarket');
  assert.equal(resolveAutomaticSubcategory({ category: 'Transport', amountSgd: -3, description: 'SMRT BUS 123' }), 'Transit');
  assert.equal(resolveAutomaticSubcategory({ category: 'Transport', amountSgd: -3, description: 'UNKNOWN OPERATOR' }), null);
  assert.equal(resolveAutomaticSubcategory({ category: 'Uncategorized', amountSgd: -3, description: 'GRAB' }), null);
  assert.ok(categorySubcategories['Food & Dining'].length === 3);
});

test('income and internal transfers do not acquire spending subcategories', async () => {
  const [income, transfer] = await classifyTransactions([
    tx('income', 100, { descriptionRaw: 'Salary GOVTECH' }),
    tx('transfer', -100, { descriptionRaw: 'REVOLUT OWN ACCOUNT' })
  ], { rules: [] });
  assert.equal(income.subcategory, null);
  assert.equal(transfer.subcategory, null);
});
