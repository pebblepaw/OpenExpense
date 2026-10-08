import test from 'node:test';
import assert from 'node:assert/strict';
import { incomeSourceFor } from '../src/income-sources.mjs';

test('income sources group recognized credits without counting reimbursements or transfers', () => {
  const credit = descriptionRaw => ({ descriptionRaw, role: 'income', amountSgd: 100 });
  assert.equal(incomeSourceFor(credit('Payment from GOVERNMENT TECHNOLOGY AGENCY')), 'Salary');
  assert.equal(incomeSourceFor(credit('TCIMO class')), 'Tuition');
  assert.equal(incomeSourceFor(credit('SAF')), 'Army payments');
  assert.equal(incomeSourceFor(credit('MINDEF payment')), 'Army payments');
  assert.equal(incomeSourceFor(credit('interest earned')), 'Interest');
  assert.equal(incomeSourceFor(credit('New employer'), { rules: [], knownPatterns: ['New employer'] }), 'New employer');
  assert.equal(incomeSourceFor(credit('Payment from Parent'), { rules: [{ name: 'Allowance', pattern: 'Parent' }] }), 'Allowance');
  assert.equal(incomeSourceFor(credit('Manually tagged income'), { rules: [], knownPatterns: [] }), 'Other income');
  for (const role of ['peer_receipt', 'refund', 'internal_transfer', 'relationship_contribution']) {
    assert.equal(incomeSourceFor({ ...credit('GOVTECH'), role }), null);
  }
  assert.equal(incomeSourceFor({ ...credit('GOVTECH'), amountSgd: -100 }), null);
});
