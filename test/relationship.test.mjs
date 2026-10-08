import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisedTransaction, buildLedger } from '../src/ledger.mjs';
import { applyRelationshipScope, buildRelationshipMetrics } from '../src/relationship.mjs';
import { buildDashboardMetrics } from '../src/metrics.mjs';
const jointId = 'DEMO-JOINT-001';
const personalId = 'DEMO-PERSONAL-001';
const partnerId = 'DEMO-PARTNER-001';
const config = { accountId: jointId, accountName: 'Relationship Account', userLabel: 'You', partnerLabel: 'Partner', personalFundingAccountIds: [personalId], partnerFundingAccountIds: [partnerId] };

test('keeps two same-day equal card purchases while merging overlapping exports', () => {
  const make = (sourceFile, row) => normalisedTransaction({
    accountId: jointId, source: 'dbs-csv', sourceFile,
    transactionDate: '2026-09-21', postedDate: '2026-09-21',
    descriptionRaw: 'BAT Shared Table PTE. LTD. SGP 18SEP', amountSgd: -8.99,
    sourceLocator: { row }
  });
  const oldRows = [make('old.csv', 1), make('old.csv', 2)];
  const newRows = [make('new.csv', 4), make('new.csv', 5)];
  const ledger = buildLedger([{ transactions: oldRows }, { transactions: newRows }]);
  assert.equal(ledger.transactions.length, 2);
  assert.equal(new Set(ledger.transactions.map((row) => row.id)).size, 2);
});

test('personal funding counts once, while joint spending stays on the relationship page', () => {
  const rows = applyRelationshipScope([
    { id: 'out', accountId: personalId, transactionDate: '2026-08-29', descriptionRaw: `TRF ${jointId}:IB`, amountSgd: -450, role: 'internal_transfer' },
    { id: 'in', accountId: jointId, transactionDate: '2026-08-29', descriptionRaw: `TRF ${personalId}:IB`, amountSgd: 450, role: 'internal_transfer' },
    { id: 'partner', accountId: jointId, transactionDate: '2026-08-29', descriptionRaw: `TRF ${partnerId}:IB`, amountSgd: 100, role: 'peer_receipt' },
    { id: 'meal', accountId: jointId, transactionDate: '2026-09-25', descriptionRaw: 'Guzman y Gomez', amountSgd: -15.8, role: 'expense', category: 'Food & Dining' }
  ], config);
  const personal = buildDashboardMetrics(rows.filter((row) => row.accountScope === 'personal'));
  const relationship = buildRelationshipMetrics(rows, [], config);
  assert.equal(personal.months.find((month) => month.month === '2026-08').netPersonalSpendSgd, 450);
  assert.equal(personal.months.some((month) => month.month === '2026-09'), false);
  assert.deepEqual(relationship.months.map((month) => [month.userFundingSgd, month.partnerFundingSgd, month.spendSgd]), [[450, 100, 0], [0, 0, 15.8]]);
});
