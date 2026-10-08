import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths as configuredPaths } from './config.mjs';
import { parseDbsCsv } from './ingest/dbs-csv.mjs';
import { parseDbsPdf } from './ingest/dbs-pdf.mjs';
import { parsePayLahPdf } from './ingest/paylah-pdf.mjs';
import { parseRevolutCsv } from './ingest/revolut.mjs';
import { buildLedger, detectCoverageGaps } from './ledger.mjs';
import { classifyTransactions } from './classify.mjs';
import { reconcileTransactions } from './reconcile.mjs';
import { buildMerchantDirectory, loadMerchantDirectory } from './merchant-directory.mjs';
import { readWorkbookManualOverrides, readWorkbookMerchantDirectory, readWorkbookRecipientAliases, writeWorkbook } from './workbook.mjs';
import { applyRelationshipScope } from './relationship.mjs';
import { relationshipAccount } from './config.mjs';
import { buildProvisionalPaylahRow } from './provisional-paylah.mjs';

export async function runRefresh({
  paths = configuredPaths,
  dryRun = false,
  pdfToText,
  workbookPath = resolve(paths.workbook ?? './master_transactions.xlsx'),
  overridePath
} = {}) {
  const dbsCsvFiles = await sourceFiles(paths.sources.dbs, /^transaction_history.*\.csv$/i);
  const dbsPdfFiles = await sourceFiles(paths.sources.dbs, /\.pdf$/i);
  const paylahPdfFiles = await sourceFiles(paths.sources.paylah, /\.pdf$/i);
  const revolutCsvFiles = await sourceFiles(paths.sources.revolut, /\.csv$/i);
  const dbsCsvImports = await Promise.all(dbsCsvFiles.map(async (file) => parseDbsCsv(await readFile(file, 'utf8'), { sourceFile: file })));
  const dbsPdfImports = await Promise.all(dbsPdfFiles.map((file) => parseDbsPdf(file, pdfToText ? { pdfToText } : undefined)));
  const paylahImports = await Promise.all(paylahPdfFiles.map((file) => parsePayLahPdf(file, pdfToText ? { pdfToText } : undefined)));
  const revolutParsed = await Promise.all(revolutCsvFiles.map(async (file) => parseRevolutCsv(await readFile(file, 'utf8'), { sourceFile: file })));
  const detailedRevolutCoverageEnd = revolutParsed
    .filter((result) => !/consolidated-statement/i.test(result.accountMetadata[0]?.sourceFile ?? ''))
    .flatMap((result) => result.coverageIntervals ?? [])
    .reduce((latest, interval) => !latest || interval.endDate > latest ? interval.endDate : latest, null);
  const revolutImports = revolutParsed.map((result) => /consolidated-statement/i.test(result.accountMetadata[0]?.sourceFile ?? '') && detailedRevolutCoverageEnd
    ? { ...result, transactions: result.transactions.filter((transaction) => transaction.transactionDate > detailedRevolutCoverageEnd) }
    : result);
  const dbsPdfFallback = selectDbsPdfFallback(dbsCsvImports, dbsPdfImports);
  const overrides = overridePath
    ? new Map(await readWorkbookManualOverrides(overridePath))
    : await readWorkbookManualOverrides(workbookPath);
  const [configuredMerchantDirectory, workbookMerchantDirectory, recipientAliases] = await Promise.all([
    loadMerchantDirectory(paths.merchantDirectory),
    readWorkbookMerchantDirectory(workbookPath),
    readWorkbookRecipientAliases(workbookPath)
  ]);
  const merchantDirectory = new Map([...configuredMerchantDirectory, ...workbookMerchantDirectory]);
  const imports = [...dbsCsvImports, ...dbsPdfFallback, ...paylahImports, ...revolutImports];
  const baseLedger = buildLedger(imports, { overrides });
  const intervals = imports.flatMap((result) => result.coverageIntervals ?? []);
  const latestDate = intervals.reduce((latest, interval) => !latest || interval.endDate > latest ? interval.endDate : latest, null);
  const coverage = {
    startDate: '2026-01-01',
    latestDate,
    intervals,
    gaps: latestDate ? detectCoverageGaps(intervals, { startDate: '2026-01-01', latestDate }).filter((gap) =>
      gap.accountId !== relationshipAccount.accountId || gap.endDate >= '2026-08-29') : []
  };
  const analysisTransactions = baseLedger.transactions.filter((transaction) => String(transaction.transactionDate ?? '') >= '2026-01-01');
  const classified = await classifyTransactions(analysisTransactions, { directory: merchantDirectory });
  const reconciliation = reconcileTransactions(classified);
  const scopedTransactions = applyRelationshipScope(reconciliation.transactions);
  const provisionalPaylah = buildProvisionalPaylahRow({ transactions: scopedTransactions, coverage });
  const ledger = { ...baseLedger, transactions: provisionalPaylah ? [...scopedTransactions, provisionalPaylah] : scopedTransactions, reconciliation };
  const merchantDirectoryRows = buildMerchantDirectory(scopedTransactions, merchantDirectory);
  const report = {
    sourceOrder: [
      { source: 'dbs-csv', files: dbsCsvFiles, rows: dbsCsvImports.reduce((sum, result) => sum + result.transactions.length, 0) },
      { source: 'dbs-pdf', files: dbsPdfFiles, parsedRows: dbsPdfImports.reduce((sum, result) => sum + result.transactions.length, 0), rows: dbsPdfFallback.reduce((sum, result) => sum + result.transactions.length, 0) },
      { source: 'paylah-pdf', files: paylahPdfFiles, rows: paylahImports.reduce((sum, result) => sum + result.transactions.length, 0) },
      { source: 'revolut-csv', files: revolutCsvFiles, rows: revolutImports.reduce((sum, result) => sum + result.transactions.length, 0) }
    ],
    ledger,
    coverage,
    merchantDirectory: merchantDirectoryRows,
    recipientAliases,
    generatedAt: new Date().toISOString()
  };
  if (!dryRun) await writeWorkbook({ transactions: ledger.transactions, accountMetadata: ledger.accountMetadata, coverage, merchantDirectory: merchantDirectoryRows, recipientAliases, workbookPath });
  return report;
}

export function selectDbsPdfFallback(dbsCsvImports, dbsPdfImports) {
  const csvRanges = new Map();
  for (const result of dbsCsvImports) {
    for (const interval of result.coverageIntervals ?? []) {
      const current = csvRanges.get(interval.accountId);
      csvRanges.set(interval.accountId, current ? {
        startDate: current.startDate < interval.startDate ? current.startDate : interval.startDate,
        endDate: current.endDate > interval.endDate ? current.endDate : interval.endDate
      } : interval);
    }
  }
  return dbsPdfImports.map((result) => {
    const transactions = result.transactions.filter((transaction) => {
      const range = csvRanges.get(transaction.accountId);
      return !range || transaction.transactionDate < range.startDate || transaction.transactionDate > range.endDate;
    });
    const dates = transactions.map((transaction) => transaction.transactionDate).filter(Boolean).sort();
    return {
      ...result,
      transactions,
      coverageIntervals: dates.length > 0 ? [{
        accountId: result.accountMetadata[0]?.accountId,
        startDate: dates[0],
        endDate: dates.at(-1),
        source: 'dbs-pdf',
        sourceFile: result.accountMetadata[0]?.sourceFile
      }] : []
    };
  }).filter((result) => result.transactions.length > 0);
}

async function sourceFiles(directory, filenamePattern) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && filenamePattern.test(entry.name))
    .map((entry) => resolve(directory, entry.name));
  const nested = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => sourceFiles(resolve(directory, entry.name), filenamePattern)));
  return [...files, ...nested.flat()].sort();
}

export function formatRefreshReport(report) {
  const source = new Map(report.sourceOrder.map((entry) => [entry.source, entry]));
  const lines = [
    `DBS CSV files: ${source.get('dbs-csv').files.length}`,
    `DBS CSV rows: ${source.get('dbs-csv').rows}`,
    `DBS PDF files scanned: ${source.get('dbs-pdf').files.length}`,
    `DBS PDF parsed rows: ${source.get('dbs-pdf').parsedRows}`,
    `DBS PDF fallback retained rows: ${source.get('dbs-pdf').rows}`,
    `PayLah PDF files: ${source.get('paylah-pdf').files.length}`,
    `PayLah PDF rows: ${source.get('paylah-pdf').rows}`,
    `Revolut CSV files: ${source.get('revolut-csv').files.length}`,
    `Revolut CSV rows: ${source.get('revolut-csv').rows}`,
    `Coverage gaps: ${report.coverage.gaps.length}`
  ];
  for (const gap of report.coverage.gaps) lines.push(`- ${gap.accountId}: ${gap.startDate} to ${gap.endDate}`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runRefresh({ dryRun: process.argv.includes('--dry-run') });
  console.log(formatRefreshReport(report));
}
