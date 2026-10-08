import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileTransactions } from '../src/reconcile.mjs';

const transaction = (id, overrides = {}) => ({
  id,
  accountId: 'dbs-savings',
  transactionDate: '2026-08-01',
  descriptionRaw: 'Transfer to owned account',
  amountSgd: -100,
  direction: 'outflow',
  manualCategory: null,
  manualSubcategory: null,
  manualRole: null,
  reviewNote: null,
  ...overrides
});

test('links equal and opposite owned-account transfers within three days and one cent', () => {
  const result = reconcileTransactions([
    transaction('dbs-to-revolut', { accountId: 'dbs-savings', transactionDate: '2026-08-01', amountSgd: -100, descriptionRaw: 'Transfer to Revolut' }),
    transaction('revolut-topup', { accountId: 'revolut-sgd', transactionDate: '2026-08-03', amountSgd: 100.01, direction: 'inflow', descriptionRaw: 'Top up by DBS' })
  ], { ownedAccountIds: ['dbs-savings', 'revolut-sgd'] });

  assert.equal(result.transferMatches.length, 1);
  assert.deepEqual(result.transferMatches[0].sourceIds, ['dbs-to-revolut', 'revolut-topup']);
  assert.deepEqual(result.transactions.map(({ id, role, linkedSourceIds }) => ({ id, role, linkedSourceIds })), [
    { id: 'dbs-to-revolut', role: 'internal_transfer', linkedSourceIds: ['revolut-topup'] },
    { id: 'revolut-topup', role: 'internal_transfer', linkedSourceIds: ['dbs-to-revolut'] }
  ]);
});

test('leaves unmatched owned-account transfer candidates in review', () => {
  const result = reconcileTransactions([
    transaction('unmatched-topup', { descriptionRaw: 'TOP-UP TO PAYLAH!', amountSgd: -25 })
  ], { ownedAccountIds: ['dbs-savings', 'paylah-wallet'] });

  assert.equal(result.transferMatches.length, 0);
  assert.equal(result.transactions[0].reviewStatus, 'needs_review');
  assert.match(result.transactions[0].reviewNote, /unmatched owned-account transfer candidate/i);
});

test('matches a DBS PayLah top-up to the wallet credit using the source-specific wording', () => {
  const result = reconcileTransactions([
    transaction('dbs-paylah-topup', { accountId: 'dbs-savings', amountSgd: -8.5, descriptionRaw: 'TOP-UP TO PAYLAH! : 00000001' }),
    transaction('wallet-topup-credit', { accountId: 'paylah-wallet', amountSgd: 8.5, direction: 'inflow', descriptionRaw: 'TOP UP WALLET FROM MY ACCOUNT' })
  ], { ownedAccountIds: ['dbs-savings', 'paylah-wallet'] });

  assert.equal(result.transferMatches.length, 1);
  assert.deepEqual(result.transferMatches[0].sourceIds, ['dbs-paylah-topup', 'wallet-topup-credit']);
  assert.deepEqual(result.transactions.map(({ role, netPersonalSpendOffsetSgd }) => ({ role, netPersonalSpendOffsetSgd })), [
    { role: 'internal_transfer', netPersonalSpendOffsetSgd: 0 },
    { role: 'internal_transfer', netPersonalSpendOffsetSgd: 0 }
  ]);
});

test('matches Apple Pay Revolut funding despite a sub-dollar card fee', () => {
  const result = reconcileTransactions([
    transaction('dbs-card-funding', { accountId: 'dbs-savings', transactionDate: '2026-05-29', amountSgd: -200.5, descriptionRaw: 'APPLE PAY TOP UP REVOLUT' }),
    transaction('revolut-apple-topup', { accountId: 'revolut-sgd', transactionDate: '2026-05-29', amountSgd: 200, direction: 'inflow', descriptionRaw: 'Apple Pay top-up by *0000' })
  ], { ownedAccountIds: ['dbs-savings', 'revolut-sgd'] });

  assert.equal(result.transferMatches.length, 1);
  assert.deepEqual(result.transactions.map(({ role }) => role), ['internal_transfer', 'internal_transfer']);
});

test('creates one audit-linked PayLah pending-wallet row and excludes its top-ups from personal spend', () => {
  const result = reconcileTransactions([
    transaction('wallet-cutoff-detail', { accountId: 'paylah-wallet', transactionDate: '2026-07-31', amountSgd: -3, descriptionRaw: 'Coffee' }),
    transaction('wallet-topup-1', { transactionDate: '2026-08-02', amountSgd: -25, descriptionRaw: 'TOP-UP TO PAYLAH!' }),
    transaction('wallet-return', { accountId: 'paylah-wallet', transactionDate: '2026-08-04', amountSgd: -10, descriptionRaw: 'Transfer to DBS Savings' })
  ], {
    ownedAccountIds: ['dbs-savings', 'paylah-wallet'],
    paylahAccountId: 'paylah-wallet',
    lastDetailedPayLahDate: '2026-07-31',
    cutoffWalletBalance: 10,
    confirmedClosingBalance: 5
  });

  const pending = result.transactions.find(({ role }) => role === 'paylah_pending_wallet');
  assert.ok(pending);
  assert.equal(pending.amountSgd, -20);
  assert.equal(pending.category, null);
  assert.deepEqual(pending.linkedSourceIds, ['wallet-topup-1', 'wallet-return']);
  const topup = result.transactions.find(({ id }) => id === 'wallet-topup-1');
  assert.equal(topup.role, 'internal_transfer');
  assert.equal(topup.netPersonalSpendOffsetSgd, 0);
});

test('atomically replaces the pending row when detailed PayLah activity covers the pending period', () => {
  const result = reconcileTransactions([
    transaction('wallet-topup', { transactionDate: '2026-08-02', amountSgd: -25, descriptionRaw: 'TOP-UP TO PAYLAH!' }),
    transaction('wallet-detail', { accountId: 'paylah-wallet', transactionDate: '2026-08-04', amountSgd: -20, descriptionRaw: 'Merchant paid from wallet' })
  ], {
    ownedAccountIds: ['dbs-savings', 'paylah-wallet'],
    paylahAccountId: 'paylah-wallet',
    lastDetailedPayLahDate: '2026-07-31',
    cutoffWalletBalance: 10,
    confirmedClosingBalance: 0,
    detailedPayLahThrough: '2026-08-04'
  });

  assert.equal(result.transactions.some(({ role }) => role === 'paylah_pending_wallet'), false);
  assert.deepEqual(result.pendingWalletReplacement.replacedSourceIds, ['wallet-topup']);
});
