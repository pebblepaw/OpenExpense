import { headerIndex, parseCsv } from '../csv.mjs';
import { normalisedTransaction, parseAmount, toIsoDate } from '../ledger.mjs';

export function parseRevolutCsv(text, { sourceFile, accountId = 'revolut-sgd' } = {}) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { transactions: [], accountMetadata: [], balanceSnapshots: [], coverageIntervals: [] };
  if (rows.some((row) => row[0] === 'Current Accounts Transaction Statements')) {
    return parseConsolidatedStatement(rows, { sourceFile, accountId });
  }
  const headers = rows[0];
  const startedDateIndex = headerIndex(headers, [/^started date$/]);
  const descriptionIndex = headerIndex(headers, [/^description$/, /^merchant$/]);
  const completedDateIndex = headerIndex(headers, [/^completed date$/, /^date$/, /^started date$/]);
  const typeIndex = headerIndex(headers, [/^type$/]);
  const debitIndex = headerIndex(headers, [/^debit$/]);
  const creditIndex = headerIndex(headers, [/^credit$/]);
  const amountIndex = headerIndex(headers, [/^amount$/]);
  const balanceIndex = headerIndex(headers, [/^balance$/]);
  const currencyIndex = headerIndex(headers, [/^currency$/]);
  const result = { transactions: [], accountMetadata: [{ accountId, accountName: 'Revolut', currentBalance: null, source: 'revolut-csv', sourceFile }], balanceSnapshots: [], coverageIntervals: [] };

  rows.slice(1).forEach((row, offset) => {
    const transactionDate = toIsoDate(row[completedDateIndex]);
    const descriptionRaw = row[descriptionIndex]?.trim();
    if (!transactionDate || !descriptionRaw) return;
    const debit = parseAmount(row[debitIndex]);
    const credit = parseAmount(row[creditIndex]);
    const amount = parseAmount(row[amountIndex]);
    const currency = row[currencyIndex]?.trim().toUpperCase();
    const amountSgd = currency && currency !== 'SGD' ? null
      : debit !== null ? -Math.abs(debit)
        : credit !== null ? Math.abs(credit)
          : amount;
    const balanceAfter = parseAmount(row[balanceIndex]);
    const sourceLocator = {
      row: offset + 2,
      startedAt: startedDateIndex < 0 ? null : row[startedDateIndex]?.trim() || null,
      completedAt: completedDateIndex < 0 ? null : row[completedDateIndex]?.trim() || null,
      transactionType: typeIndex < 0 ? null : row[typeIndex]?.trim() || null
    };
    result.transactions.push(normalisedTransaction({
      source: 'revolut-csv', sourceFile, accountId, transactionDate, postedDate: transactionDate,
      descriptionRaw, amountSgd, balanceAfter, sourceLocator
    }));
    if (balanceAfter !== null) result.balanceSnapshots.push({ accountId, balance: balanceAfter, statementDate: transactionDate, source: 'revolut-csv', sourceFile, sourceLocator });
  });
  const dates = result.transactions.map((transaction) => transaction.transactionDate).filter(Boolean).sort();
  const exportPeriod = String(sourceFile ?? '').match(/account-statement_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/);
  if (dates.length > 0 || exportPeriod) result.coverageIntervals.push({
    accountId,
    startDate: exportPeriod?.[1] ?? dates[0],
    endDate: exportPeriod?.[2] ?? dates.at(-1),
    source: 'revolut-csv', sourceFile
  });
  return result;
}

function parseConsolidatedStatement(rows, { sourceFile, accountId }) {
  const result = { transactions: [], accountMetadata: [{ accountId, accountName: 'Revolut', currentBalance: null, source: 'revolut-csv', sourceFile }], balanceSnapshots: [], coverageIntervals: [] };
  let inSgdTransactions = false;
  let inTable = false;
  rows.forEach((row, index) => {
    if (row[0] === 'Personal Account (SGD)' && rows[index - 2]?.[0] === 'Current Accounts Transaction Statements') {
      inSgdTransactions = true;
      return;
    }
    if (!inSgdTransactions) return;
    if (row[0] === 'Personal Account (USD)') {
      inSgdTransactions = false;
      return;
    }
    if (row[0] === 'Date' && row[1] === 'Description' && row[3] === 'Money in/out') {
      inTable = true;
      return;
    }
    if (!inTable) return;
    const transactionDate = toIsoDate(row[0]);
    const descriptionRaw = String(row[1] ?? '').trim();
    const amountSgd = parseAmount(row[3]);
    if (!transactionDate || !descriptionRaw || amountSgd === null) return;
    const balanceAfter = parseAmount(row[4]);
    const sourceLocator = { row: index + 1, transactionType: row[2]?.trim() || null };
    result.transactions.push(normalisedTransaction({ source: 'revolut-csv', sourceFile, accountId, transactionDate, postedDate: transactionDate, descriptionRaw, amountSgd, balanceAfter, sourceLocator }));
    if (balanceAfter !== null) result.balanceSnapshots.push({ accountId, balance: balanceAfter, statementDate: transactionDate, source: 'revolut-csv', sourceFile, sourceLocator });
  });
  const exportPeriod = String(sourceFile ?? '').match(/consolidated-statement(?:-v\d+)?_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/);
  const dates = result.transactions.map((transaction) => transaction.transactionDate).sort();
  if (dates.length || exportPeriod) result.coverageIntervals.push({ accountId, startDate: exportPeriod?.[1] ?? dates[0], endDate: exportPeriod?.[2] ?? dates.at(-1), source: 'revolut-csv', sourceFile });
  return result;
}
