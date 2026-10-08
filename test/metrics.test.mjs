import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBalanceSeries, buildDashboardMetrics, deriveDbsBaseline } from '../src/metrics.mjs';

test('December forecast includes unpaid current-month income without paying it twice', () => {
  for (const received of [0, 500, 3000]) {
    const result = buildDashboardMetrics([
      { transactionDate: '2026-09-01', role: 'income', amountSgd: 3000 },
      { transactionDate: '2026-09-02', role: 'expense', amountSgd: -1000 },
      { transactionDate: '2026-10-01', role: 'income', amountSgd: received }
    ], { forecastFromDate: '2026-10-06', baselineBalanceSgd: 10000 });
    assert.equal(result.forecast[0].incomeSgd, 3000 - received);
    assert.ok(Math.abs(result.forecast[0].spendSgd - 1000 * 25 / 31) < 0.000001);
    assert.equal(result.forecast[1].incomeSgd, 3000);
    assert.ok(Math.abs(result.projectedYearEndBalanceSgd - (10000 + 3000 - received - 1000 * 25 / 31 + 4000)) < 0.000001);
  }
});

test('separates recognised income, net personal spend, and peer receipts by month', () => {
  const result = buildDashboardMetrics([
    { id: 'income', transactionDate: '2026-05-01', amountSgd: 3000, role: 'income' },
    { id: 'food', transactionDate: '2026-05-02', amountSgd: -40, role: 'expense', category: 'Food & Dining' },
    { id: 'peer', transactionDate: '2026-05-03', amountSgd: 15, role: 'peer_receipt' },
    { id: 'transfer', transactionDate: '2026-05-04', amountSgd: -200, role: 'internal_transfer' }
  ], { baselineBalanceSgd: 1000 });
  const month = result.months.find((entry) => entry.month === '2026-05');
  assert.equal(month.netIncomeSgd, 3000);
  assert.equal(month.netPersonalSpendSgd, 25);
  assert.equal(month.savedSgd, 2975);
  assert.equal(month.categories['Food & Dining'], 40);
});

test('reconstructs combined month-end balances from account anchors and marks gaps and partial months', () => {
  const transactions = [
    { accountId: 'dbs-1', transactionDate: '2026-08-15', amountSgd: 50 },
    { accountId: 'dbs-1', transactionDate: '2026-09-04', amountSgd: -20 },
    { accountId: 'paylah-1', transactionDate: '2026-08-20', amountSgd: 30 },
    { accountId: 'paylah-1', transactionDate: '2026-09-02', amountSgd: -30 }
  ];
  const accountMetadata = [
    { accountId: 'dbs-1', source: 'dbs-csv', statementDate: '2026-09-26', currentBalance: 100 },
    { accountId: 'paylah-1', source: 'paylah-pdf', currentBalance: null }
  ];
  const coverage = { gaps: [{ accountId: 'paylah-1', startDate: '2026-09-05', endDate: '2026-09-26' }] };
  const series = buildBalanceSeries({ transactions, accountMetadata, coverage, latestDate: '2026-09-26', startDate: '2026-08-01' });

  assert.deepEqual(series.map(({ month, balanceSgd, estimated, partial }) => ({ month, balanceSgd, estimated, partial })), [
    { month: '2026-08', balanceSgd: 150, estimated: true, partial: false },
    { month: '2026-09', balanceSgd: 100, estimated: false, partial: true }
  ]);
  const metrics = buildDashboardMetrics(transactions, { balanceSeries: series });
  assert.deepEqual(metrics.balanceSeries.map(({ month, balanceSgd }) => ({ month, balanceSgd })), [
    { month: '2026-08', balanceSgd: 150 },
    { month: '2026-09', balanceSgd: 100 }
  ]);
  assert.ok(metrics.monthlyMetricsRows.some((row) => row.month === '2026-08' && row.metric === 'End balance' && row.amountSgd === 150));
});

test('builds category series and month-on-month changes for transparent dashboard rollups', () => {
  const result = buildDashboardMetrics([
    { id: 'food-may', transactionDate: '2026-05-02', amountSgd: -40, role: 'expense', category: 'Food & Dining' },
    { id: 'food-jun', transactionDate: '2026-06-02', amountSgd: -65, role: 'expense', category: 'Food & Dining' },
    { id: 'income-jun', transactionDate: '2026-06-01', amountSgd: 3000, role: 'income' }
  ]);

  assert.deepEqual(result.categorySeries.find(({ category }) => category === 'Food & Dining').months, [
    { month: '2026-05', amountSgd: 40, changeSgd: null },
    { month: '2026-06', amountSgd: 65, changeSgd: 25 }
  ]);
  assert.ok(result.monthlyMetricsRows.some((row) => row.month === '2026-06' && row.metric === 'Category spend' && row.category === 'Food & Dining' && row.amountSgd === 65 && row.changeSgd === 25));
});

test('reconstructs a combined DBS baseline by reversing post-cutoff activity', () => {
  const result = deriveDbsBaseline({
    transactions: [
      { accountId: 'dbs-1', transactionDate: '2026-08-03', amountSgd: -20 },
      { accountId: 'dbs-2', transactionDate: '2026-08-03', amountSgd: 50 },
      { accountId: 'revolut-sgd', transactionDate: '2026-08-03', amountSgd: 999 }
    ],
    accountMetadata: [
      { accountId: 'dbs-1', source: 'dbs-csv', currentBalance: 100, accountName: 'DBS One' },
      { accountId: 'dbs-2', source: 'dbs-csv', currentBalance: 200, accountName: 'DBS Two' },
      { accountId: 'revolut-sgd', source: 'revolut-csv', currentBalance: 500, accountName: 'Revolut' }
    ],
    coverage: { gaps: [{ accountId: 'dbs-2', startDate: '2026-08-05', endDate: '2026-08-10' }] }
  });
  assert.equal(result.balanceSgd, 270);
  assert.deepEqual(result.accounts.map(({ accountId, baselineBalanceSgd, estimated }) => ({ accountId, baselineBalanceSgd, estimated })), [
    { accountId: 'dbs-1', baselineBalanceSgd: 120, estimated: false },
    { accountId: 'dbs-2', baselineBalanceSgd: 150, estimated: true }
  ]);
});
