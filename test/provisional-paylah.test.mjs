import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProvisionalPaylahRow } from '../src/provisional-paylah.mjs';

const coverage = {
  latestDate: '2026-09-26',
  intervals: [{ accountId: 'paylah-123', source: 'paylah-pdf', startDate: '2026-08-05', endDate: '2026-09-04' }],
  gaps: [{ accountId: 'paylah-123', startDate: '2026-09-05', endDate: '2026-09-26' }]
};

test('provisionally counts bank top-ups after the last PayLah detail without inventing merchants', () => {
  const row = buildProvisionalPaylahRow({
    transactions: [
      { id: 'topup-1', source: 'dbs-csv', accountId: 'dbs-1', transactionDate: '2026-09-06', descriptionRaw: 'TOP-UP TO PAYLAH! : 00000001 TF123', amountSgd: -7, role: 'internal_transfer' },
      { id: 'topup-2', source: 'dbs-csv', accountId: 'dbs-1', transactionDate: '2026-09-07', descriptionRaw: 'TOP-UP TO PAYLAH! : demo_wallet PLPE123', amountSgd: -2.8, role: 'internal_transfer' },
      { id: 'old', source: 'dbs-csv', accountId: 'dbs-1', transactionDate: '2026-09-04', descriptionRaw: 'TOP-UP TO PAYLAH!', amountSgd: -8, role: 'internal_transfer' },
      { id: 'other', source: 'dbs-csv', accountId: 'dbs-1', transactionDate: '2026-09-08', descriptionRaw: 'PAYNOW TRANSFER', amountSgd: -40, role: 'transfer_to_person' }
    ],
    coverage
  });
  assert.equal(row.amountSgd, -9.8);
  assert.equal(row.role, 'paylah_pending_wallet');
  assert.equal(row.category, 'Pending PayLah detail');
  assert.equal(row.accountId, 'paylah-123');
  assert.match(row.reviewNote, /provisional/i);
});

test('removes the provisional PayLah row once detailed coverage catches up', () => {
  const row = buildProvisionalPaylahRow({
    transactions: [{ id: 'topup', source: 'dbs-csv', accountId: 'dbs-1', transactionDate: '2026-09-06', descriptionRaw: 'TOP-UP TO PAYLAH!', amountSgd: -7, role: 'internal_transfer' }],
    coverage: { ...coverage, intervals: [{ accountId: 'paylah-123', source: 'paylah-pdf', startDate: '2026-09-05', endDate: '2026-09-26' }] }
  });
  assert.equal(row, null);
});
