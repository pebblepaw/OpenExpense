import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTransactions, loadMerchantRules } from '../src/classify.mjs';
import { accountHolderPatterns, knownIncomePatterns, revolutAccountPatterns } from '../src/config.mjs';
import { loadMerchantDirectory } from '../src/merchant-directory.mjs';

const transaction = (id, overrides = {}) => ({
  id,
  accountId: 'dbs-savings',
  transactionDate: '2026-08-01',
  descriptionRaw: 'Unknown transaction',
  amountSgd: -10,
  direction: 'outflow',
  manualCategory: null,
  manualSubcategory: null,
  manualRole: null,
  reviewNote: null,
  ...overrides
});

test('manual category, subcategory, and role overrides take precedence over automation', async () => {
  const [classified] = await classifyTransactions([transaction('manual-income', {
    descriptionRaw: 'Incoming PayNow from GOVTECH',
    amountSgd: 4000,
    direction: 'inflow',
    manualCategory: 'Shopping',
    manualSubcategory: 'Gift',
    manualRole: 'refund'
  })]);

  assert.equal(classified.roleAuto, 'income');
  assert.equal(classified.category, 'Shopping');
  assert.equal(classified.subcategory, 'Gift');
  assert.equal(classified.role, 'refund');
});

test('recognises the approved income counterparties', async () => {
  const names = knownIncomePatterns;
  const classified = await classifyTransactions(names.map((name, index) => transaction(`income-${index}`, {
    descriptionRaw: `Incoming PayNow from ${name}`,
    amountSgd: 1000,
    direction: 'inflow'
  })));

  assert.deepEqual(classified.map(({ roleAuto, role }) => ({ roleAuto, role })), names.map(() => ({ roleAuto: 'income', role: 'income' })));
});

test('treats interest as income and user-owned funding as an internal transfer', async () => {
  const holderDescription = accountHolderPatterns[0] ? `Payment from ${accountHolderPatterns[0]}` : 'Payment from OWN ACCOUNT';
  const revAccount = revolutAccountPatterns[0] ?? 'REVOLUT_ACCOUNT';
  const classified = await classifyTransactions([
    transaction('interest', { descriptionRaw: 'Preferential rate — Interest Earned', amountSgd: 1, direction: 'inflow' }),
    transaction('user-funding', { descriptionRaw: holderDescription, amountSgd: 145, direction: 'inflow' }),
    transaction('wallet-funding', { descriptionRaw: 'TOP UP WALLET FROM MY ACCOUNT', amountSgd: 5, direction: 'inflow' }),
    transaction('dbs-to-revolut', { descriptionRaw: `TRF DBS:I-BANK ${revAccount} REVOLUT OTHR Transfer 00000000000000000001 — Advice`, amountSgd: -367, direction: 'outflow' })
  ]);
  assert.deepEqual(classified.map(({ role, category }) => ({ role, category })), [
    { role: 'income', category: null },
    { role: 'internal_transfer', category: null },
    { role: 'internal_transfer', category: null },
    { role: 'internal_transfer', category: null }
  ]);
});

test('uses merchant rules before conservative fallback rules', async () => {
  const rules = await loadMerchantRules();
  const [classified] = await classifyTransactions([transaction('fairprice', {
    descriptionRaw: 'BAT FAIRPRICE FINEST SGP'
  })], { rules });

  assert.equal(classified.categoryAuto, 'Groceries');
  assert.equal(classified.category, 'Groceries');
  assert.equal(classified.subcategory, 'Supermarket');
});

test('categorises gym purchases and recurring bills without guessing unrelated merchants', async () => {
  const classified = await classifyTransactions([
    transaction('creatine', { descriptionRaw: 'Creatine monohydrate order' }),
    transaction('mobile', { descriptionRaw: 'GOMO MOBILE PLAN' }),
    transaction('unknown', { descriptionRaw: 'An unfamiliar merchant' })
  ]);

  assert.deepEqual(classified.map(({ category, recurring }) => ({ category, recurring })), [
    { category: 'Gym', recurring: false },
    { category: 'Bills', recurring: true },
    { category: 'Uncategorized', recurring: false }
  ]);
});

test('clearing a manual tag recomputes the category instead of retaining the last displayed value', async () => {
  const [classified] = await classifyTransactions([transaction('retagged-then-cleared', {
    descriptionRaw: 'Opaque merchant reference',
    category: 'Food & Dining',
    categoryAuto: null,
    manualCategory: null,
    role: 'expense'
  })]);
  assert.equal(classified.categoryAuto, null);
  assert.equal(classified.category, 'Uncategorized');
});

test('marks a clear payment to a person as a transfer and unexplained incoming money as reviewable peer receipt', async () => {
  const classified = await classifyTransactions([
    transaction('person-payment', { descriptionRaw: 'PayNow transfer to Alice Tan' }),
    transaction('peer-receipt', { descriptionRaw: 'Incoming PayNow from Bob Lim', amountSgd: 35, direction: 'inflow' }),
    transaction('refund', { descriptionRaw: 'Card payment refund from Merchant', amountSgd: 12, direction: 'inflow' })
  ]);

  assert.equal(classified[0].category, 'Transfers to People');
  assert.equal(classified[0].role, 'transfer_to_person');
  assert.equal(classified[1].role, 'peer_receipt');
  assert.equal(classified[1].reviewStatus, 'needs_review');
  assert.equal(classified[1].netPersonalSpendOffsetSgd, -35);
  assert.equal(classified[2].role, 'refund');
});

test('separates opaque PayNow transfers from uncategorized merchants', async () => {
  const classified = await classifyTransactions([
    transaction('outgoing-paynow', { descriptionRaw: 'PAYNOW TEST PERSON PAYNOW TRANSFER', amountSgd: -6, direction: 'outflow' }),
    transaction('incoming-paynow', { descriptionRaw: 'Incoming PayNow Ref 0000001 From: TEST RECIPIENT', amountSgd: 37, direction: 'inflow' }),
    transaction('paylah-receipt', { descriptionRaw: 'RECEIVE MONEY FROM 00000002', amountSgd: 27.5, direction: 'inflow' }),
    transaction('opaque-bank-transfer', { descriptionRaw: 'DBS:I-BANK 000000000000001 OTHR Transfer 00000000000000000002' })
  ]);
  assert.deepEqual(classified.map(({ role, category }) => ({ role, category })), [
    { role: 'transfer_to_person', category: 'Unclassified Transfers' },
    { role: 'peer_receipt', category: 'Unclassified Transfers' },
    { role: 'peer_receipt', category: 'Unclassified Transfers' },
    { role: 'transfer_to_person', category: 'Unclassified Transfers' }
  ]);
});

test('preserves an owned-account transfer role supplied by reconciliation', async () => {
  const [classified] = await classifyTransactions([transaction('reconciled-transfer', {
    descriptionRaw: 'Transfer to Alice Tan',
    roleAuto: 'internal_transfer',
    role: 'internal_transfer'
  })]);

  assert.equal(classified.roleAuto, 'internal_transfer');
  assert.equal(classified.role, 'internal_transfer');
});

test('uses a researched merchant directory entry before leaving a merchant uncategorized', async () => {
  const [classified] = await classifyTransactions([transaction('matsumoto', {
    descriptionRaw: 'BAT MATSUMOTO SINGAPORE SGP 06JUL 0000-0000-0000-0000 000000000000001 — Point-of-Sale Transaction'
  })], {
    directory: new Map([['MATSUMOTO', { category: 'Food & Dining', subcategory: 'Restaurant', displayName: 'Matsumoto' }]])
  });
  assert.equal(classified.merchantKey, 'MATSUMOTO');
  assert.equal(classified.category, 'Food & Dining');
  assert.equal(classified.subcategoryAuto, 'Restaurant');
  assert.equal(classified.subcategory, 'Other meals (<$20)');
});

test('classifies identified ICA and tailoring merchants without inferring the payment processor', async () => {
  const directory = await loadMerchantDirectory();
  const classified = await classifyTransactions([
    transaction('ica', { descriptionRaw: 'PAYNOW IMMIGRATIO QR00000000000001', amountSgd: -75 }),
    transaction('tailor', { descriptionRaw: 'PAYNOW OUMI FABRI QS', amountSgd: -48 }),
    transaction('processor', { descriptionRaw: 'PAYNOW QASHIER-AG... QSB-SQR-SG-000000001', amountSgd: -7 })
  ], { directory });
  assert.deepEqual(classified.map(({ category }) => category), ['Fees', 'Shopping', 'Uncategorized']);
});

test('applies current directory mappings for KFC, Anthropic, Google Cloud, and evidence-backed merchants', async () => {
  const [rules, directory] = await Promise.all([loadMerchantRules(), loadMerchantDirectory()]);
  const inputs = [
    transaction('kfc', { descriptionRaw: 'BAT KFC DTE 519 Singapore SGP 08AUG 0000-0000-0000-0000 000000000000002 — Point-of-Sale Transaction' }),
    transaction('anthropic', { descriptionRaw: 'Anthropic' }),
    transaction('google-cloud', { descriptionRaw: 'Google Cloud' }),
    transaction('letsgo', { descriptionRaw: 'Letsgo Network' }),
    transaction('casa-vostra', { descriptionRaw: 'BAT CASA VOSTRA RETAIL Si SGP 30APR 0000-0000-0000-0000 000000000000003' }),
    transaction('keisuke', { descriptionRaw: 'BAT WWW.KEISUK* TONKOTSUKI SI SGP 29JUN 0000-0000-0000-0000 000000000000004 — Point-of-Sale Transaction' }),
    transaction('foodie-market', { descriptionRaw: 'PAYNOW FOODIE MAR... FMP KATONG' }),
    transaction('tony-cafe', { descriptionRaw: 'PAYNOW TONY CAFE COLEMAN STREET BRANC' }),
    transaction('makan-boleh', { descriptionRaw: 'MAKAN BOLEH' }),
    transaction('old-hen', { descriptionRaw: 'BAT OLDHENCOFFEE / CHOOBY SI SGP 26JUN 0000-0000-0000-0000 000000000000005 — Point-of-Sale Transaction' }),
    transaction('postcard', { descriptionRaw: 'BAT POSTCARD ORCHARD SI SGP 27FEB 0000-0000-0000-0000 000000000000006 — Point-of-Sale Transaction' }),
    transaction('bread-ambiguous', { descriptionRaw: 'PAYNOW BREAD HAVE... NA' })
  ];

  const classified = await classifyTransactions(inputs, { rules, directory });
  // Merchant types stay durable in the directory; final Food/Shopping bands are tested separately.
  assert.deepEqual(classified.map(({ category, subcategoryAuto, recurring }) => ({ category, subcategory: subcategoryAuto, recurring })), [
    { category: 'Food & Dining', subcategory: 'Fast food', recurring: false },
    { category: 'Bills', subcategory: 'Software Subscription', recurring: true },
    { category: 'Education & Work', subcategory: 'Software subscription', recurring: true },
    { category: 'Bills', subcategory: 'Software Subscription', recurring: false },
    { category: 'Food & Dining', subcategory: 'Restaurant', recurring: false },
    { category: 'Food & Dining', subcategory: 'Restaurant', recurring: false },
    { category: 'Groceries', subcategory: 'Specialty grocery', recurring: false },
    { category: 'Food & Dining', subcategory: 'Cafe', recurring: false },
    { category: 'Food & Dining', subcategory: 'Restaurant', recurring: false },
    { category: 'Food & Dining', subcategory: 'Cafe', recurring: false },
    { category: 'Shopping', subcategory: 'Health & beauty', recurring: false },
    { category: 'Food & Dining', subcategory: 'Bakery', recurring: false }
  ]);
});
