import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import { parseDbsCsv } from '../src/ingest/dbs-csv.mjs';
import { parseRevolutCsv } from '../src/ingest/revolut.mjs';
import { parseDbsPdf, parseDbsPdfText } from '../src/ingest/dbs-pdf.mjs';
import { parsePayLahPdf, parsePayLahPdfText } from '../src/ingest/paylah-pdf.mjs';
import { buildLedger, describeCoverage, detectCoverageGaps, loadManualOverrides, normalisedTransaction } from '../src/ledger.mjs';
import { formatRefreshReport, runRefresh } from '../src/refresh.mjs';

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parses quoted DBS metadata and transactions into normalised rows', async () => {
  const result = parseDbsCsv(await fixture('dbs-history.csv'), {
    sourceFile: 'synthetic-dbs.csv'
  });

  assert.deepEqual(result.accountMetadata, [{
    accountId: '123-456-789',
    accountName: 'My Account, Joint',
    currentBalance: 1234.56,
    source: 'dbs-csv',
    sourceFile: 'synthetic-dbs.csv'
  }]);
  assert.equal(result.transactions.length, 2);
  assert.deepEqual(result.transactions[0], {
    id: result.transactions[0].id,
    fingerprint: result.transactions[0].fingerprint,
    source: 'dbs-csv',
    sourceFile: 'synthetic-dbs.csv',
    accountId: '123-456-789',
    transactionDate: '2026-03-03',
    postedDate: '2026-03-03',
    descriptionRaw: 'PAYNOW TO "JANE, DOE"',
    amountSgd: -12.34,
    balanceAfter: 1222.22,
    direction: 'outflow',
    roleAuto: null,
    categoryAuto: null,
    manualCategory: null,
    manualSubcategory: null,
    manualRole: null,
    reviewNote: null,
    sourceLocator: { row: 5 }
  });
  assert.equal(result.balanceSnapshots.at(-1).balance, 3222.22);
});

test('parses Revolut debit and credit columns as signed SGD amounts', async () => {
  const result = parseRevolutCsv(await fixture('revolut.csv'), {
    sourceFile: 'synthetic-revolut.csv'
  });

  assert.deepEqual(result.transactions.map(({ descriptionRaw, amountSgd, direction, transactionDate }) => ({
    descriptionRaw,
    amountSgd,
    direction,
    transactionDate
  })), [
    { descriptionRaw: 'Coffee, Roaster', amountSgd: -4.5, direction: 'outflow', transactionDate: '2026-03-05' },
    { descriptionRaw: 'Refund', amountSgd: 1.25, direction: 'inflow', transactionDate: '2026-03-06' }
  ]);
});

test('parses Revolut consolidated SGD transactions and export coverage', () => {
  const text = [
    '"Current Accounts Transaction Statements",,,,,',
    ',,,,,',
    '"Personal Account (SGD)",,,,,',
    '"Transaction statement",,,,,',
    'Date,Description,Category,"Money in/out",Balance,Fees',
    '"30 Sept 2026","Apple Pay top-up by *0000","Top up","S$49.85","S$53.71","S$0.15"',
    '"1 Oct 2026",Contabo,Merchant,"-S$11.77","S$0.54","S$0.12"',
    '"Personal Account (USD)",,,,,',
    'Date,Description,Category,"Money in/out","Money in/out",Balance',
    '"1 Oct 2026",USD item,Merchant,"-$10.00","-S$12.00","$0.00"'
  ].join('\n');
  const result = parseRevolutCsv(text, { sourceFile: 'consolidated-statement-v2_2026-01-01_2026-10-06_en-sg.csv' });
  assert.deepEqual(result.transactions.map(({ transactionDate, descriptionRaw, amountSgd }) => ({ transactionDate, descriptionRaw, amountSgd })), [
    { transactionDate: '2026-09-30', descriptionRaw: 'Apple Pay top-up by *0000', amountSgd: 49.85 },
    { transactionDate: '2026-10-01', descriptionRaw: 'Contabo', amountSgd: -11.77 }
  ]);
  assert.equal(result.coverageIntervals[0].endDate, '2026-10-06');
});

test('parses PayLah DB and CR statement text with a balance snapshot', async () => {
  const result = parsePayLahPdfText(await fixture('paylah.txt'), {
    sourceFile: 'synthetic-paylah.pdf'
  });

  assert.deepEqual(result.transactions.map(({ descriptionRaw, amountSgd, direction }) => ({
    descriptionRaw,
    amountSgd,
    direction
  })), [
    { descriptionRaw: 'HAWKER CENTRE', amountSgd: -5.2, direction: 'outflow' },
    { descriptionRaw: 'PAYNOW FROM FRIEND', amountSgd: 8, direction: 'inflow' }
  ]);
  assert.equal(result.balanceSnapshots[0].balance, 219.36);
});

test('keeps PDF-only January and February DBS history while CSV wins the matching March row', async () => {
  const [csv, pdf] = await Promise.all([
    fixture('dbs-history.csv').then((text) => parseDbsCsv(text, { sourceFile: 'synthetic-dbs.csv' })),
    fixture('dbs-history.txt').then((text) => parseDbsPdfText(text, { sourceFile: 'synthetic-dbs.pdf' }))
  ]);
  const ledger = buildLedger([pdf, csv]);

  assert.deepEqual(ledger.transactions.map(({ transactionDate, descriptionRaw, source }) => ({
    transactionDate,
    descriptionRaw,
    source
  })), [
    { transactionDate: '2026-01-15', descriptionRaw: 'JANUARY PDF ONLY', source: 'dbs-pdf' },
    { transactionDate: '2026-02-15', descriptionRaw: 'FEBRUARY PDF ONLY', source: 'dbs-pdf' },
    { transactionDate: '2026-03-03', descriptionRaw: 'PAYNOW TO "JANE, DOE"', source: 'dbs-csv' },
    { transactionDate: '2026-03-04', descriptionRaw: 'SALARY, ACME PTE LTD', source: 'dbs-csv' }
  ]);
  assert.equal(ledger.duplicates.length, 1);
});

test('deduplicates identical PayLah PDFs by stable fingerprint', async () => {
  const text = await fixture('paylah.txt');
  const ledger = buildLedger([
    parsePayLahPdfText(text, { sourceFile: 'synthetic-paylah-a.pdf' }),
    parsePayLahPdfText(text, { sourceFile: 'synthetic-paylah-b.pdf' })
  ]);

  assert.equal(ledger.transactions.length, 2);
  assert.equal(ledger.duplicates.length, 2);
  assert.equal(ledger.transactions[0].id, ledger.transactions[0].fingerprint);
});

test('parses DB and CR DBS rows from ordinary pdftotext output', async () => {
  const result = parseDbsPdfText(await fixture('dbs-pdftotext.txt'), {
    sourceFile: 'synthetic-pdftotext.pdf'
  });

  assert.deepEqual(result.transactions.map(({ accountId, descriptionRaw, amountSgd, balanceAfter }) => ({
    accountId,
    descriptionRaw,
    amountSgd,
    balanceAfter
  })), [
    { accountId: '555-666-777', descriptionRaw: 'CASH WITHDRAWAL', amountSgd: -50, balanceAfter: 900 },
    { accountId: '555-666-777', descriptionRaw: 'REFUND FROM SHOP', amountSgd: 10, balanceAfter: 910 }
  ]);
});

test('reports imported source date coverage for a later refresh command', () => {
  assert.deepEqual(describeCoverage([
    { source: 'dbs-csv', transactionDate: '2026-03-01' },
    { source: 'dbs-csv', transactionDate: '2026-08-29' },
    { source: 'dbs-pdf', transactionDate: '2026-01-01' },
    { source: 'dbs-pdf', transactionDate: '2026-02-28' }
  ]), [
    'dbs-csv: 2026-03-01 to 2026-08-29',
    'dbs-pdf: 2026-01-01 to 2026-02-28'
  ]);
});

test('uses a pdftotext converter before parsing DBS and PayLah PDF files', async () => {
  const convertedFiles = [];
  const pdfToText = async (file) => {
    convertedFiles.push(file);
    return file === 'synthetic-dbs.pdf'
      ? await fixture('dbs-history.txt')
      : await fixture('paylah.txt');
  };

  const [dbs, paylah] = await Promise.all([
    parseDbsPdf('synthetic-dbs.pdf', { pdfToText }),
    parsePayLahPdf('synthetic-paylah.pdf', { pdfToText })
  ]);

  assert.deepEqual(convertedFiles.sort(), ['synthetic-dbs.pdf', 'synthetic-paylah.pdf']);
  assert.equal(dbs.transactions[0].sourceFile, 'synthetic-dbs.pdf');
  assert.equal(paylah.transactions[0].sourceFile, 'synthetic-paylah.pdf');
});

test('refresh dry-run reports the CSV-first policy without requiring private statements', async context => {
  const temporary = await mkdtemp(join(tmpdir(), 'openexpense-report-test-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const sources = { dbs: join(temporary, 'dbs'), paylah: join(temporary, 'paylah'), revolut: join(temporary, 'revolut') };
  await Promise.all(Object.values(sources).map(directory => mkdir(directory)));
  await copyFile(new URL('./fixtures/dbs-history.csv', import.meta.url), join(sources.dbs, 'transaction_history-demo.csv'));
  const report = await runRefresh({ dryRun: true, paths: { sources }, workbookPath: join(temporary, 'ledger.xlsx') });
  const output = formatRefreshReport(report);

  assert.match(output, /DBS CSV files: [1-9]\d*/);
  assert.match(output, /DBS PDF fallback retained rows:/);
  assert.match(output, /Coverage gaps:/);
});

test('parses the reduced real DBS CSV layout and derives its printed account number', async () => {
  const result = parseDbsCsv(await fixture('dbs-real-layout.csv'), { sourceFile: 'reduced-dbs.csv' });

  assert.equal(result.accountMetadata[0].accountId, '123-456789-0');
  assert.equal(result.transactions[0].transactionDate, '2026-01-02');
  assert.equal(result.transactions[0].descriptionRaw, 'Debit Card Transaction — TEST SHOP SGP');
  assert.equal(result.transactions[0].sourceLocator.reference, 'REF-100');
});

test('parses multiline real DBS PDF rows using the statement year and printed account number', async () => {
  const result = parseDbsPdfText(await fixture('dbs-real-layout.txt'), { sourceFile: 'reduced-dbs.pdf' });

  assert.deepEqual(result.transactions.map(({ accountId, transactionDate, descriptionRaw, amountSgd, balanceAfter, sourceLocator }) => ({ accountId, transactionDate, descriptionRaw, amountSgd, balanceAfter, sourceLocator })), [
    { accountId: '123-456789-0', transactionDate: '2026-01-02', descriptionRaw: 'Debit Card Transaction — TEST SHOP SGP', amountSgd: -2.45, balanceAfter: 316.19, sourceLocator: { line: 6, reference: 'REF-100' } },
    { accountId: '123-456789-0', transactionDate: '2026-01-03', descriptionRaw: 'Advice Funds Transfer', amountSgd: 300, balanceAfter: 616.19, sourceLocator: { line: 9, reference: 'REF-200' } }
  ]);
});

test('uses the repeated page header when DBS changes its printed column offsets', () => {
  const text = `Details of Your My Account
1 Jan 2026 to 31 Jan 2026    Account No.: 123-456789-0
DATE         DESCRIPTION                                                         WITHDRAWAL           DEPOSIT                 BALANCE
02 Jan       Debit Card Transaction                                                    2.45                                    316.19
                 FIRST SHOP
                 REF-100
PAGE 2 of 2
Details of Your My Account
1 Jan 2026 to 31 Jan 2026    Account No.: 123-456789-0
DATE         DESCRIPTION                                     WITHDRAWAL               DEPOSIT              BALANCE
05 Jan       Debit Card Transaction                                3.40                                     462.31
                 SECOND SHOP
                 REF-200`;
  const result = parseDbsPdfText(text, { sourceFile: 'shifted-columns.pdf' });
  assert.deepEqual(result.transactions.map(({ transactionDate, descriptionRaw, amountSgd, balanceAfter }) => ({ transactionDate, descriptionRaw, amountSgd, balanceAfter })), [
    { transactionDate: '2026-01-02', descriptionRaw: 'Debit Card Transaction — FIRST SHOP', amountSgd: -2.45, balanceAfter: 316.19 },
    { transactionDate: '2026-01-05', descriptionRaw: 'Debit Card Transaction — SECOND SHOP', amountSgd: -3.4, balanceAfter: 462.31 }
  ]);
});

test('uses the common DBS account ID and reference to prefer the CSV row', async () => {
  const [csv, pdf] = await Promise.all([
    fixture('dbs-real-layout.csv').then((text) => parseDbsCsv(text, { sourceFile: 'reduced-dbs.csv' })),
    fixture('dbs-real-layout.txt').then((text) => parseDbsPdfText(text, { sourceFile: 'reduced-dbs.pdf' }))
  ]);
  const ledger = buildLedger([pdf, csv]);

  assert.equal(ledger.transactions.length, 2);
  assert.equal(ledger.transactions.find((transaction) => transaction.sourceLocator.reference === 'REF-100').source, 'dbs-csv');
});

test('parses the reduced real Revolut timestamp layout', async () => {
  const result = parseRevolutCsv(await fixture('revolut-real-layout.csv'), { sourceFile: 'reduced-revolut.csv' });

  assert.deepEqual(result.transactions.map(({ transactionDate, amountSgd, descriptionRaw }) => ({ transactionDate, amountSgd, descriptionRaw })), [
    { transactionDate: '2026-08-28', amountSgd: -4.5, descriptionRaw: 'Test Cafe, SG' },
    { transactionDate: '2026-08-29', amountSgd: 1.25, descriptionRaw: 'Test Refund' }
  ]);
});

test('parses the reduced real PayLah layout with statement-derived dates and wallet identity', async () => {
  const result = parsePayLahPdfText(await fixture('paylah-real-layout.txt'), { sourceFile: 'reduced-paylah.pdf' });

  assert.deepEqual(result.transactions.map(({ accountId, transactionDate, amountSgd, sourceLocator }) => ({ accountId, transactionDate, amountSgd, sourceLocator })), [
    { accountId: 'paylah-1111222233334444', transactionDate: '2026-01-08', amountSgd: -2, sourceLocator: { line: 9, reference: 'IPS-100' } },
    { accountId: 'paylah-1111222233334444', transactionDate: '2026-01-15', amountSgd: 25.6, sourceLocator: { line: 11, reference: 'TF-200' } }
  ]);
  assert.deepEqual(result.coverageIntervals, [{ accountId: 'paylah-1111222233334444', startDate: '2026-01-05', endDate: '2026-02-04', source: 'paylah-pdf', sourceFile: 'reduced-paylah.pdf' }]);
});

test('uses the wallet number rather than the statement day when PayLah prints all header values on one line', () => {
  const result = parsePayLahPdfText(`STATEMENT DATE      MOBILE NUMBER      WALLET ACCOUNT\n04 Aug 2026          6000000000         1111222233334444\n05 Jul TEST SHOP 1.00 DB`, { sourceFile: 'reduced-paylah-header.pdf' });

  assert.equal(result.accountMetadata[0].accountId, 'paylah-1111222233334444');
});

test('uses Revolut started date when a transaction has no completed timestamp', async () => {
  const text = `${await fixture('revolut-real-layout.csv')}CARD_PAYMENT,Current,2026-08-30 08:30:00,,Pending test,-1.00,0.00,SGD,PENDING,95.75\n`;
  const result = parseRevolutCsv(text, { sourceFile: 'reduced-revolut.csv' });

  assert.equal(result.transactions.at(-1).transactionDate, '2026-08-30');
});

test('deduplicates overlapping Revolut exports when merchant display names change', () => {
  const header = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n';
  const oldExport = parseRevolutCsv(`${header}Card Payment,Current,2026-08-11 00:11:34,2026-08-11 20:08:58,CLAUDE,-84.25,0.00,SGD,COMPLETED,67.40\n`, {
    sourceFile: 'account-statement_2023-07-11_2026-08-29.csv'
  });
  const newExport = parseRevolutCsv(`${header}Card Payment,Current,2026-08-11 00:11:34,2026-08-11 20:08:58,Anthropic,-84.25,0.00,SGD,COMPLETED,67.40\n`, {
    sourceFile: 'account-statement_2026-07-01_2026-09-26.csv'
  });
  const ledger = buildLedger([oldExport, newExport]);

  assert.equal(ledger.transactions.length, 1);
  assert.equal(ledger.transactions[0].descriptionRaw, 'Anthropic');
  assert.equal(ledger.duplicates[0].reason, 'secondary_revolut_key');
});

test('Revolut overlap deduplication retains manual tags and distinct same-value charges', () => {
  const header = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n';
  const oldExport = parseRevolutCsv(`${header}Card Payment,Current,2026-08-11 00:11:34,2026-08-11 20:08:58,CLAUDE,-84.25,0.00,SGD,COMPLETED,67.40\n`, {
    sourceFile: 'account-statement_2023-07-11_2026-08-29.csv'
  });
  const newExport = parseRevolutCsv(`${header}Card Payment,Current,2026-08-11 00:11:34,2026-08-11 20:08:58,Anthropic,-84.25,0.00,SGD,COMPLETED,67.40\nCard Payment,Current,2026-08-11 02:11:34,2026-08-11 20:10:58,Anthropic,-84.25,0.00,SGD,COMPLETED,67.40\n`, {
    sourceFile: 'account-statement_2026-07-01_2026-09-26.csv'
  });
  const overrides = new Map([[oldExport.transactions[0].id, { manualCategory: 'Education & Work' }]]);
  const ledger = buildLedger([oldExport, newExport], { overrides });

  assert.equal(ledger.transactions.length, 2);
  assert.equal(ledger.transactions.find((row) => row.sourceLocator.startedAt === '2026-08-11 00:11:34').manualCategory, 'Education & Work');
});

test('preserves stable manual overrides from an override input and leaves new rows null', async () => {
  const overrides = await loadManualOverrides({ overridePath: new URL('./fixtures/manual-overrides.csv', import.meta.url) });
  const ledger = buildLedger([{ transactions: [
    { id: 'txn_existing', fingerprint: 'txn_existing', source: 'dbs-csv', sourceFile: 'source.csv', accountId: '123', transactionDate: '2026-01-01', postedDate: '2026-01-01', descriptionRaw: 'Existing', amountSgd: -1, balanceAfter: null, direction: 'outflow', roleAuto: null, categoryAuto: null, manualCategory: null, manualSubcategory: null, manualRole: null, reviewNote: null, sourceLocator: { row: 1 } },
    { id: 'txn_new', fingerprint: 'txn_new', source: 'dbs-csv', sourceFile: 'source.csv', accountId: '123', transactionDate: '2026-01-02', postedDate: '2026-01-02', descriptionRaw: 'New', amountSgd: -2, balanceAfter: null, direction: 'outflow', roleAuto: null, categoryAuto: null, manualCategory: null, manualSubcategory: null, manualRole: null, reviewNote: null, sourceLocator: { row: 2 } }
  ] }], { overrides });

  assert.deepEqual(ledger.transactions.map(({ id, manualCategory, manualSubcategory, manualRole, reviewNote }) => ({ id, manualCategory, manualSubcategory, manualRole, reviewNote })), [
    { id: 'txn_existing', manualCategory: 'Gym', manualSubcategory: 'Membership', manualRole: 'expense', reviewNote: 'keep this choice' },
    { id: 'txn_new', manualCategory: null, manualSubcategory: null, manualRole: null, reviewNote: null }
  ]);
});

test('detects account coverage gaps through the latest source date', () => {
  assert.deepEqual(detectCoverageGaps([
    { accountId: 'dbs-1', startDate: '2026-01-01', endDate: '2026-01-31' },
    { accountId: 'dbs-1', startDate: '2026-03-01', endDate: '2026-03-31' },
    { accountId: 'paylah-1', startDate: '2026-01-05', endDate: '2026-02-04' }
  ], { startDate: '2026-01-01', latestDate: '2026-03-31' }), [
    { accountId: 'dbs-1', startDate: '2026-02-01', endDate: '2026-02-28' },
    { accountId: 'paylah-1', startDate: '2026-01-01', endDate: '2026-01-04' },
    { accountId: 'paylah-1', startDate: '2026-02-05', endDate: '2026-03-31' }
  ]);
});

test('dry-run scans source directories with CSV priority and returns source coverage gaps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'banking-statements-'));
  const dbsDirectory = join(root, 'dbs');
  const paylahDirectory = join(root, 'paylah');
  const revolutDirectory = join(root, 'revolut');
  await Promise.all([mkdir(dbsDirectory), mkdir(paylahDirectory), mkdir(revolutDirectory)]);
  await Promise.all([
    copyFile(new URL('./fixtures/dbs-real-layout.csv', import.meta.url), join(dbsDirectory, 'transaction_history_reduced.csv')),
    writeFile(join(dbsDirectory, 'Deposit Account Statement_reduced.pdf'), 'synthetic placeholder'),
    writeFile(join(paylahDirectory, 'PayLah_reduced.pdf'), 'synthetic placeholder'),
    copyFile(new URL('./fixtures/revolut-real-layout.csv', import.meta.url), join(revolutDirectory, 'account-statement_reduced.csv'))
  ]);
  const report = await runRefresh({
    paths: { sources: { dbs: dbsDirectory, paylah: paylahDirectory, revolut: revolutDirectory } },
    dryRun: true,
    pdfToText: async (filePath) => fixture(basename(filePath).startsWith('PayLah') ? 'paylah-real-layout.txt' : 'dbs-real-layout.txt')
  });

  assert.deepEqual(report.sourceOrder.map(({ source, files }) => ({ source, files: files.length })), [
    { source: 'dbs-csv', files: 1 },
    { source: 'dbs-pdf', files: 1 },
    { source: 'paylah-pdf', files: 1 },
    { source: 'revolut-csv', files: 1 }
  ]);
  assert.ok(report.coverage.gaps.some((gap) => gap.accountId === 'paylah-1111222233334444'));
  assert.ok(report.ledger.transactions.some((transaction) => transaction.source === 'revolut-csv'));
  assert.match(formatRefreshReport(report), /DBS PDF parsed rows: 2/);
});

test('canonical DBS fingerprints merge source variants but do not merge a same-value different counterparty', () => {
  const shared = {
    accountId: '123-456789-0', transactionDate: '2026-03-01', postedDate: '2026-03-01',
    amountSgd: -12.34, balanceAfter: null, roleAuto: null, categoryAuto: null,
    manualCategory: null, manualSubcategory: null, manualRole: null, reviewNote: null
  };
  const csv = normalisedTransaction({
    ...shared, source: 'dbs-csv', sourceFile: 'synthetic.csv',
    descriptionRaw: 'BAT ALPHA SHOP SI SGP 28FEB 0000-0000-0000-0000 000000123456 — Point-of-Sale Transaction',
    sourceLocator: { row: 1, reference: '0000-0000-0000-0000' }
  });
  const pdf = normalisedTransaction({
    ...shared, source: 'dbs-pdf', sourceFile: 'synthetic.pdf',
    descriptionRaw: 'Debit Card Transaction — ALPHA SHOP SI SGP 28FEB',
    sourceLocator: { line: 4, reference: '000000123456' }
  });
  const differentCounterparty = normalisedTransaction({
    ...shared, source: 'dbs-pdf', sourceFile: 'synthetic.pdf',
    descriptionRaw: 'Debit Card Transaction — BETA SHOP SI SGP 28FEB',
    sourceLocator: { line: 8, reference: '000000654321' }
  });
  const ledger = buildLedger([{ transactions: [pdf, csv, differentCounterparty] }]);

  assert.equal(csv.fingerprint, pdf.fingerprint);
  assert.notEqual(csv.fingerprint, differentCounterparty.fingerprint);
  assert.equal(ledger.transactions.length, 2);
  assert.equal(ledger.transactions.find((transaction) => transaction.fingerprint === csv.fingerprint).source, 'dbs-csv');
  assert.notEqual(csv.sourceLocator.reference, pdf.sourceLocator.reference);
});

test('actual DBS source overlaps deduplicate with CSV priority using canonical fingerprints', async () => {
  const directory = 'POSB:DBS Bank Statement';
  if (!existsSync(directory)) return;
  const files = await readdir(directory);
  const [csvImports, pdfImports] = await Promise.all([
    Promise.all(files.filter((file) => /^transaction_history.*\.csv$/i.test(file)).map(async (file) => parseDbsCsv(await readFile(resolve(directory, file), 'utf8'), { sourceFile: resolve(directory, file) }))),
    Promise.all(files.filter((file) => /\.pdf$/i.test(file)).map((file) => parseDbsPdf(resolve(directory, file))))
  ]);
  const csvRows = csvImports.flatMap((result) => result.transactions);
  const pdfRows = pdfImports.flatMap((result) => result.transactions);
  const csvByAccountDateAmount = new Map(csvRows.map((transaction) => [[transaction.accountId, transaction.transactionDate, transaction.amountSgd?.toFixed(2)].join('|'), transaction]));
  const matchedPairs = pdfRows.map((transaction) => [csvByAccountDateAmount.get([transaction.accountId, transaction.transactionDate, transaction.amountSgd?.toFixed(2)].join('|')), transaction]).filter(([csv, pdf]) => csv && csv.fingerprint === pdf.fingerprint);
  const ledger = buildLedger([...pdfImports, ...csvImports]);

  assert.ok(matchedPairs.length >= 30, `expected at least 30 canonical overlap matches, found ${matchedPairs.length}`);
  for (const [csv] of matchedPairs) {
    assert.equal(ledger.transactions.find((transaction) => transaction.fingerprint === csv.fingerprint).source, 'dbs-csv');
  }
});

test('secondary DBS matching deduplicates generic or shared-reference pairs but not distinct merchants', () => {
  const common = { accountId: '123-456789-0', postedDate: '2026-04-01', amountSgd: -9.99, balanceAfter: null };
  const transaction = (source, sourceFile, transactionDate, descriptionRaw, reference) => normalisedTransaction({
    ...common, source, sourceFile, transactionDate, descriptionRaw, sourceLocator: { row: 1, reference }
  });
  const genericCsv = transaction('dbs-csv', 'synthetic.csv', '2026-04-01', 'TRF FT260401MB12345678 123-456789-0 IB — Advice', '123-456789-0');
  const genericPdf = transaction('dbs-pdf', 'synthetic.pdf', '2026-04-01', 'Advice Funds Transfer', 'FT260401MB12345678');
  const referenceCsv = transaction('dbs-csv', 'synthetic.csv', '2026-04-02', 'Card purchase ALPHA 000000123456', 'card-a');
  const referencePdf = transaction('dbs-pdf', 'synthetic.pdf', '2026-04-02', 'Debit card transaction BETA', '000000123456');
  const merchantCsv = transaction('dbs-csv', 'synthetic.csv', '2026-04-03', 'ALPHA SHOP', 'card-b');
  const merchantPdf = transaction('dbs-pdf', 'synthetic.pdf', '2026-04-03', 'BETA SHOP', 'card-c');
  const ledger = buildLedger([{ transactions: [genericPdf, genericCsv, referencePdf, referenceCsv, merchantPdf, merchantCsv] }]);

  assert.equal(ledger.transactions.length, 4);
  assert.equal(ledger.transactions.find((row) => row.transactionDate === '2026-04-01').source, 'dbs-csv');
  assert.equal(ledger.transactions.find((row) => row.transactionDate === '2026-04-02').source, 'dbs-csv');
  assert.equal(ledger.transactions.filter((row) => row.transactionDate === '2026-04-03').length, 2);
  assert.equal(ledger.duplicates.filter((duplicate) => duplicate.reason === 'secondary_dbs_key').length, 2);
});

test('real DBS overlap report records conservative secondary matches with CSV priority', async () => {
  const directory = 'POSB:DBS Bank Statement';
  if (!existsSync(directory)) return;
  const files = await readdir(directory);
  const [csvImports, pdfImports] = await Promise.all([
    Promise.all(files.filter((file) => /^transaction_history.*\.csv$/i.test(file)).map(async (file) => parseDbsCsv(await readFile(resolve(directory, file), 'utf8'), { sourceFile: resolve(directory, file) }))),
    Promise.all(files.filter((file) => /\.pdf$/i.test(file)).map((file) => parseDbsPdf(resolve(directory, file))))
  ]);
  const ledger = buildLedger([...pdfImports, ...csvImports]);
  const secondary = ledger.duplicates.filter((duplicate) => duplicate.reason === 'secondary_dbs_key');

  assert.ok(secondary.length >= 12, `expected at least 12 conservative secondary matches, found ${secondary.length}`);
  assert.ok(secondary.every((duplicate) => duplicate.kept.source === 'dbs-csv'));
});

test('keeps an ambiguous DBS CSV/PDF overlap separate and flags both rows for review', () => {
  const common = { accountId: '123-456789-0', transactionDate: '2026-04-04', postedDate: '2026-04-04', amountSgd: -7.77, balanceAfter: null };
  const csv = normalisedTransaction({
    ...common, source: 'dbs-csv', sourceFile: 'synthetic.csv', descriptionRaw: 'ALPHA SHOP', sourceLocator: { row: 1, reference: 'card-a' }
  });
  const pdf = normalisedTransaction({
    ...common, source: 'dbs-pdf', sourceFile: 'synthetic.pdf', descriptionRaw: 'BETA SHOP', sourceLocator: { line: 1, reference: 'card-b' }
  });
  const ledger = buildLedger([{ transactions: [csv, pdf] }]);

  assert.equal(ledger.transactions.length, 2);
  assert.deepEqual(ledger.transactions.map((row) => row.reviewNote), [
    'ambiguous CSV/PDF duplicate',
    'ambiguous CSV/PDF duplicate'
  ]);
  assert.deepEqual(ledger.transactions.map((row) => row.reviewStatus), [
    'needs_review',
    'needs_review'
  ]);
});

test('real unresolved DBS overlap is marked for review without being deduplicated', async () => {
  const directory = 'POSB:DBS Bank Statement';
  if (!existsSync(directory)) return;
  const files = await readdir(directory);
  const [csvImports, pdfImports] = await Promise.all([
    Promise.all(files.filter((file) => /^transaction_history.*\.csv$/i.test(file)).map(async (file) => parseDbsCsv(await readFile(resolve(directory, file), 'utf8'), { sourceFile: resolve(directory, file) }))),
    Promise.all(files.filter((file) => /\.pdf$/i.test(file)).map((file) => parseDbsPdf(resolve(directory, file))))
  ]);
  const ledger = buildLedger([...pdfImports, ...csvImports]);
  const ambiguous = ledger.transactions.filter((row) => row.reviewNote === 'ambiguous CSV/PDF duplicate');

  assert.ok(ambiguous.length >= 2, `expected at least two unresolved overlaps, found ${ambiguous.length}`);
  assert.deepEqual(new Set(ambiguous.map((row) => row.source)), new Set(['dbs-csv', 'dbs-pdf']));
});
