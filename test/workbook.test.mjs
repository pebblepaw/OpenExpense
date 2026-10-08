import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { readWorkbookManualOverrides, readWorkbookMerchantDirectory, readWorkbookRecipientAliases, writeWorkbook } from '../src/workbook.mjs';
import { recipientNumberFor } from '../src/recipients.mjs';
import { runRefresh } from '../src/refresh.mjs';

const coverage = {
  startDate: '2026-01-01',
  latestDate: '2026-01-03',
  intervals: [{ accountId: 'dbs-1', startDate: '2026-01-01', endDate: '2026-01-03', source: 'dbs-csv', sourceFile: 'statement.csv' }],
  gaps: [{ accountId: 'paylah-1', startDate: '2026-01-01', endDate: '2026-01-03' }]
};

function transaction(overrides = {}) {
  return {
    id: 'txn-stable-1',
    fingerprint: 'txn-stable-1',
    source: 'dbs-csv',
    sourceFile: 'statement.csv',
    accountId: 'dbs-1',
    transactionDate: '2026-01-02',
    postedDate: '2026-01-03',
    descriptionRaw: 'Test merchant',
    amountSgd: -12.5,
    balanceAfter: 87.5,
    direction: 'outflow',
    roleAuto: 'expense',
    categoryAuto: 'Food & Dining',
    subcategoryAuto: 'Cafe',
    role: 'expense',
    category: 'Food & Dining',
    subcategory: 'Cafe',
    manualCategory: null,
    manualSubcategory: null,
    manualRole: null,
    reviewStatus: 'needs_review',
    reviewNote: 'Needs a look',
    ...overrides
  };
}

async function importedWorkbook(path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

async function withWorkbook(testBody) {
  const directory = await mkdtemp(join(tmpdir(), 'banking-workbook-'));
  const workbookPath = join(directory, 'master_transactions.xlsx');
  try {
    await testBody(workbookPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('writes an editable Transactions ledger with typed dates, values, filters, and support sheets', async () => {
  await withWorkbook(async (workbookPath) => {
    const merchantDirectory = [{
      merchantKey: 'TEST MERCHANT', displayName: 'Test Merchant', category: 'Food & Dining', subcategory: 'Cafe',
      confidence: 'high', sourceUrl: 'https://example.com', notes: 'Synthetic test row', reviewStatus: 'reviewed',
      transactionCount: 1, totalSpendSgd: 12.5, exampleDescription: 'Test merchant'
    }];
    await writeWorkbook({ transactions: [transaction({ sourceFile: '/private/tmp/statement.csv' })], coverage, merchantDirectory, workbookPath });

    const workbook = await importedWorkbook(workbookPath);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Transactions', 'Assumptions', 'Source Coverage', 'Merchant Directory', 'Recipient Directory', 'Monthly Metrics', 'Relationship Account', '_Validation']);

    const transactions = workbook.getWorksheet('Transactions');
    assert.equal(Object.keys(transactions.tables).length, 1);
    assert.equal(transactions.getTable('TransactionsTable').table.columns[0].filterButton, true);
    const [headers, row] = rangeValues(transactions, 'A1:W2');
    assert.ok(headers.includes('manualCategory'));
    assert.equal(row[3], 'statement.csv');
    // Dates remain typed Excel values.
    assert.ok(row[5] instanceof Date || typeof row[5] === 'number');
    if (row[5] instanceof Date) assert.equal(row[5].toISOString().slice(0, 10), '2026-01-02');
    assert.equal(transactions.getCell('F2').numFmt, 'yyyy-mm-dd');
    assert.equal(row[8], -12.5);
    assert.equal(row[9], 87.5);
    assert.equal(transactions.getCell('Q2').dataValidation.type, 'list');

    assert.equal(rangeValues(workbook.getWorksheet('Assumptions'), 'B2')[0][0], 'SGD');
    assert.ok(rangeValues(workbook.getWorksheet('Source Coverage'), 'A1:G3').flat().includes('Coverage gap'));
    const directory = workbook.getWorksheet('Merchant Directory');
    assert.equal(Object.keys(directory.tables).length, 1);
    assert.equal(rangeValues(directory, 'A1:K2')[1][0], 'TEST MERCHANT');
    assert.equal(directory.getCell('C2').dataValidation.type, 'list');
    assert.equal(rangeValues(workbook.getWorksheet('Monthly Metrics'), 'A1:H1')[0][0], 'month');
  });
});

test('preserves editable PayLah recipient names in the workbook across rebuilds', async () => {
  await withWorkbook(async (workbookPath) => {
    await writeWorkbook({ transactions: [transaction()], coverage, workbookPath, recipientAliases: new Map([['91234567', 'Alex']]) });
    assert.equal((await readWorkbookRecipientAliases(workbookPath)).get('91234567'), 'Alex');
    await writeWorkbook({ transactions: [transaction()], coverage, workbookPath });
    assert.equal((await readWorkbookRecipientAliases(workbookPath)).get('91234567'), 'Alex');
    assert.equal(recipientNumberFor({ source: 'paylah-pdf', role: 'transfer_to_person', descriptionRaw: 'SEND MONEY TO 91234567' }), '91234567');
    assert.equal(recipientNumberFor({ source: 'dbs-csv', role: 'transfer_to_person', descriptionRaw: 'TRF 91234567:IB' }), null);
  });
});

test('migrates the old friends transfer label in manual workbook tags', async () => {
  await withWorkbook(async (workbookPath) => {
    await writeWorkbook({ transactions: [transaction({ manualCategory: 'Transfer to Friends/Others' })], coverage, workbookPath });
    assert.equal((await readWorkbookManualOverrides(workbookPath)).get('txn-stable-1').manualCategory, 'Transfers to People');
  });
});

test('preserves merchant-directory edits as refreshable classification mappings', async () => {
  await withWorkbook(async (workbookPath) => {
    await writeWorkbook({
      transactions: [transaction()], coverage, workbookPath,
      merchantDirectory: [{ merchantKey: 'TEST MERCHANT', displayName: 'Test Merchant', category: 'Food & Dining', subcategory: 'Cafe' }]
    });
    const mappings = await readWorkbookMerchantDirectory(workbookPath);
    assert.deepEqual(mappings.get('TEST MERCHANT'), {
      displayName: 'Test Merchant', category: 'Food & Dining', subcategory: 'Cafe', confidence: null, sourceUrl: null, notes: null
    });
  });
});

test('does not treat an unclassified directory row as an override of researched mappings', async () => {
  await withWorkbook(async (workbookPath) => {
    await writeWorkbook({
      transactions: [transaction()], coverage, workbookPath,
      merchantDirectory: [{ merchantKey: 'TEST MERCHANT', displayName: 'Test Merchant', category: 'Uncategorized', subcategory: null }]
    });
    assert.equal((await readWorkbookMerchantDirectory(workbookPath)).has('TEST MERCHANT'), false);
  });
});

test('preserves all manual transaction fields by stable ID across a refresh', async () => {
  await withWorkbook(async (workbookPath) => {
    await writeWorkbook({
      transactions: [transaction({ manualCategory: 'Gym', manualSubcategory: 'Membership', manualRole: 'expense', reviewNote: 'Keep this note' })],
      coverage,
      workbookPath
    });
    await writeWorkbook({ transactions: [transaction({ reviewNote: null })], coverage, workbookPath });

    const row = rangeValues((await importedWorkbook(workbookPath)).getWorksheet('Transactions'), 'A1:W2')[1];
    assert.deepEqual(row.slice(16, 20), ['Gym', 'Membership', 'expense', 'Keep this note']);
  });
});

test('browser saves replace and clear old manual tags rather than restoring workbook values', async () => {
  await withWorkbook(async (workbookPath) => {
    await writeWorkbook({ transactions: [transaction({ manualCategory: 'Gym' })], coverage, workbookPath });
    await writeWorkbook({ transactions: [transaction({ manualCategory: 'Shopping', manualSubcategory: 'Big purchases ($50+)', subcategory: 'Big purchases ($50+)' })], coverage, workbookPath, preserveManualOverrides: false });
    assert.equal((await readWorkbookManualOverrides(workbookPath)).get('txn-stable-1').manualCategory, 'Shopping');
    assert.equal((await importedWorkbook(workbookPath)).getWorksheet('Transactions').getCell('X2').value, 'Big purchases ($50+)');
    await writeWorkbook({ transactions: [transaction({ manualCategory: null, manualSubcategory: null, reviewNote: null })], coverage, workbookPath, preserveManualOverrides: false });
    const overrides = (await readWorkbookManualOverrides(workbookPath)).get('txn-stable-1');
    assert.equal(overrides.manualCategory, null);
    assert.equal(overrides.manualSubcategory, null);
  });
});

test('refresh exports the real pipeline shape and discovers nested PayLah statement files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'banking-refresh-'));
  const dbs = join(directory, 'dbs');
  const paylah = join(directory, 'paylah');
  const revolut = join(directory, 'revolut');
  const workbookPath = join(directory, 'master_transactions.xlsx');
  const merchantDirectoryPath = join(directory, 'merchant_directory.csv');
  try {
    await Promise.all([mkdir(dbs), mkdir(join(paylah, 'PDF'), { recursive: true }), mkdir(revolut)]);
    await Promise.all([
      copyFile(new URL('./fixtures/dbs-real-layout.csv', import.meta.url), join(dbs, 'transaction_history_reduced.csv')),
      writeFile(join(paylah, 'PDF', 'statement.pdf'), 'synthetic PDF placeholder'),
      copyFile(new URL('./fixtures/revolut-real-layout.csv', import.meta.url), join(revolut, 'account-statement_reduced.csv'))
    ]);
    await writeFile(merchantDirectoryPath, 'merchantKey,displayName,category,subcategory,confidence,sourceUrl,notes\nTEST SHOP,Test Shop,Food & Dining,Cafe,high,https://example.com,test\n');
    const report = await runRefresh({
      paths: { workbook: workbookPath, merchantDirectory: merchantDirectoryPath, sources: { dbs, paylah, revolut } },
      pdfToText: async () => 'STATEMENT DATE      MOBILE NUMBER      WALLET ACCOUNT\n04 Aug 2026          6000000000         1111222233334444\n05 Jul TEST SHOP 1.00 DB'
    });

    assert.equal(report.sourceOrder.find((source) => source.source === 'paylah-pdf').files.length, 1);
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(report.ledger.transactions.some((row) => row.source === 'paylah-pdf'));
    assert.equal(report.ledger.transactions.find((row) => row.descriptionRaw === 'TEST SHOP')?.category, 'Food & Dining');
    assert.ok(rangeValues((await importedWorkbook(workbookPath)).getWorksheet('Transactions'), 'A1:W10').flat().includes('paylah-pdf'));
    assert.ok(rangeValues((await importedWorkbook(workbookPath)).getWorksheet('Merchant Directory'), 'A1:K10').flat().includes('TEST SHOP'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function rangeValues(sheet, range) {
  const [start,end=start] = range.split(':');
  const a=sheet.getCell(start),b=sheet.getCell(end);
  return Array.from({length:b.row-a.row+1},(_,r) => Array.from({length:b.col-a.col+1},(_,c) => sheet.getCell(a.row+r,a.col+c).value));
}
