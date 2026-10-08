import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMerchantDirectory, loadMerchantDirectory, merchantDirectoryEntryFor, merchantKeyFor } from '../src/merchant-directory.mjs';

test('extracts merchant keys from DBS card statement wrappers', () => {
  assert.equal(
    merchantKeyFor('BAT MATSUMOTO SINGAPORE SGP 06JUL 0000-0000-0000-0000 000000000000001 — Point-of-Sale Transaction'),
    'MATSUMOTO'
  );
  assert.equal(
    merchantKeyFor('Debit Card Transaction — NUS MULTI-PURPOSE CO-O Si SGP 15JAN'),
    'NUS MULTI PURPOSE CO O'
  );
});

test('keeps direct merchant names and marks person-to-person descriptions as non-merchants', () => {
  assert.equal(merchantKeyFor('Old Hen Kitchen'), 'OLD HEN KITCHEN');
  assert.equal(merchantKeyFor('SEND MONEY TO 00000002'), null);
});

test('builds one editable directory row per merchant and retains researched values', () => {
  const rows = buildMerchantDirectory([
    { descriptionRaw: 'BAT MATSUMOTO SINGAPORE SGP 06JUL 0000-0000-0000-0000 000000000000001 — Point-of-Sale Transaction', amountSgd: -12, role: 'expense', category: 'Uncategorized' },
    { descriptionRaw: 'Matsumoto', amountSgd: -8, role: 'expense', category: 'Food & Dining' },
    { descriptionRaw: 'SEND MONEY TO 00000002', amountSgd: -10, role: 'expense', category: 'Uncategorized' }
  ], new Map([['MATSUMOTO', { displayName: 'Matsumoto', category: 'Food & Dining', sourceUrl: 'https://example.test/matsumoto', confidence: 'high' }]]));
  assert.deepEqual(rows, [{
    merchantKey: 'MATSUMOTO', displayName: 'Matsumoto', category: 'Food & Dining', subcategory: null,
    confidence: 'high', sourceUrl: 'https://example.test/matsumoto', notes: null, reviewStatus: 'reviewed',
    transactionCount: 2, totalSpendSgd: 20, exampleDescription: 'BAT MATSUMOTO SINGAPORE SGP 06JUL 0000-0000-0000-0000 000000000000001 — Point-of-Sale Transaction'
  }]);
});

test('loads reviewed merchant mappings from a portable CSV directory', async () => {
  const path = join(tmpdir(), `merchant-directory-${Date.now()}.csv`);
  await writeFile(path, 'merchantKey,displayName,category,subcategory,confidence,sourceUrl,notes\nMATSUMOTO,Matsumoto,Food & Dining,Restaurant,high,https://example.test,verified\n');
  const directory = await loadMerchantDirectory(path);
  assert.deepEqual(directory.get('MATSUMOTO'), {
    displayName: 'Matsumoto', category: 'Food & Dining', subcategory: 'Restaurant', confidence: 'high', sourceUrl: 'https://example.test', notes: 'verified'
  });
});

test('applies a durable merchant mapping to location and reference variants', () => {
  const directory = new Map([['SPOTIFY', { displayName: 'Spotify', category: 'Entertainment', subcategory: 'Music subscription' }]]);
  assert.deepEqual(merchantDirectoryEntryFor('SPOTIFY STOCKHOLM SWE 30JUN', directory), directory.get('SPOTIFY'));
  const rows = buildMerchantDirectory([{ role: 'expense', amountSgd: -12, descriptionRaw: 'SPOTIFY STOCKHOLM SWE 30JUN', category: 'Uncategorized' }], directory);
  assert.equal(rows[0].category, 'Entertainment');
  assert.equal(rows[0].displayName, 'Spotify');
});

test('matches short merchant aliases only at the start of a key and prefers the longest prefix', () => {
  const short = { displayName: 'KFC', category: 'Food & Dining' };
  const broad = { displayName: 'Google', category: 'Education & Work' };
  const specific = { displayName: 'Google Cloud', category: 'Bills' };
  const directory = new Map([
    ['KFC', short],
    ['GOOGLE', broad],
    ['GOOGLE CLOUD', specific]
  ]);

  assert.equal(merchantDirectoryEntryFor('KFC DTE 519', directory), short);
  assert.equal(merchantDirectoryEntryFor('Google Cloud Singapore', directory), specific);
  assert.equal(merchantDirectoryEntryFor('NOT KFC DTE 519', directory), null);
});

test('does not treat an unrelated key containing a merchant alias as a match', () => {
  const directory = new Map([['BREADTALK', { displayName: 'BreadTalk', category: 'Food & Dining' }]]);
  assert.equal(merchantDirectoryEntryFor('PAYNOW BREAD HAVE NA', directory), null);
});

test('a transaction-level browser retag does not silently become a reusable merchant mapping', () => {
  const rows = buildMerchantDirectory([{
    role: 'expense', amountSgd: -14, descriptionRaw: 'AMBIGUOUS SHOP',
    category: 'Food & Dining', categoryAuto: null, manualCategory: 'Food & Dining'
  }]);
  assert.equal(rows[0].category, 'Uncategorized');
  assert.equal(rows[0].reviewStatus, 'needs_review');
});
