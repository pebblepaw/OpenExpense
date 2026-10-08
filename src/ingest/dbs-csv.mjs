import { headerIndex, normaliseHeader, parseCsv } from '../csv.mjs';
import { normalisedTransaction, parseAmount, toIsoDate } from '../ledger.mjs';

const emptyResult = () => ({ transactions: [], accountMetadata: [], balanceSnapshots: [], coverageIntervals: [] });

export function parseDbsCsv(text, { sourceFile, accountId: requestedAccountId } = {}) {
  const rows = parseCsv(text);
  const headerRow = rows.findIndex((row) => row.some((value) => /transaction date|value date|posting date/i.test(value))
    && row.some((value) => /description|particulars|details/i.test(value)));
  if (headerRow === -1) return emptyResult();

  const metadata = readMetadata(rows.slice(0, headerRow));
  const headers = rows[headerRow];
  const accountId = requestedAccountId ?? metadata.accountNumber ?? `dbs:${sourceFile}`;
  const descriptionIndex = headerIndex(headers, [/^description$/, /^particulars$/, /^details$/]);
  const transactionDateIndex = headerIndex(headers, [/^transaction date$/, /^date$/]);
  const postedDateIndex = headerIndex(headers, [/^value date$/, /^posting date$/, /^posted date$/]);
  const debitIndex = headerIndex(headers, [/^debit amount$/, /^debit$/, /^withdrawal$/]);
  const creditIndex = headerIndex(headers, [/^credit amount$/, /^credit$/, /^deposit$/]);
  const balanceIndex = headerIndex(headers, [/^balance$/, /^running balance$/]);
  const supplementaryDescriptionIndex = headerIndex(headers, [/^supplementary code description$/, /^transaction ref 1$/]);
  const referenceIndexes = [
    headerIndex(headers, [/^client reference$/]),
    headerIndex(headers, [/^additional reference$/]),
    headerIndex(headers, [/^transaction ref 1$/]),
    headerIndex(headers, [/^transaction ref 2$/]),
    headerIndex(headers, [/^transaction ref 3$/])
  ].filter((index) => index >= 0);
  const result = emptyResult();

  if (metadata.currentBalance !== null) {
    result.balanceSnapshots.push({
      accountId,
      balance: metadata.currentBalance,
      statementDate: null,
      source: 'dbs-csv',
      sourceFile,
      sourceLocator: { row: metadata.currentBalanceRow }
    });
  }
  result.accountMetadata.push({
    accountId,
    accountName: metadata.accountName ?? null,
    currentBalance: metadata.currentBalance,
    ...(metadata.ledgerBalance !== null ? { ledgerBalance: metadata.ledgerBalance } : {}),
    ...(metadata.statementDate ? { statementDate: metadata.statementDate } : {}),
    source: 'dbs-csv',
    sourceFile
  });

  rows.slice(headerRow + 1).forEach((row, offset) => {
    const transactionDate = toIsoDate(row[transactionDateIndex]);
    const descriptionParts = [row[descriptionIndex], row[supplementaryDescriptionIndex]]
      .map((value) => value?.trim())
      .filter((value, index, values) => value && values.indexOf(value) === index);
    const descriptionRaw = descriptionParts.join(' — ');
    if (!transactionDate || !descriptionRaw) return;
    const debit = parseAmount(row[debitIndex]);
    const credit = parseAmount(row[creditIndex]);
    const amountSgd = debit !== null ? -Math.abs(debit) : credit !== null ? Math.abs(credit) : null;
    const balanceAfter = parseAmount(row[balanceIndex]);
    const reference = referenceIndexes.map((index) => row[index]?.trim()).find(Boolean);
    const sourceLocator = reference ? { row: headerRow + offset + 2, reference } : { row: headerRow + offset + 2 };
    result.transactions.push(normalisedTransaction({
      source: 'dbs-csv', sourceFile, accountId, transactionDate,
      postedDate: toIsoDate(row[postedDateIndex]) ?? transactionDate,
      descriptionRaw, amountSgd, balanceAfter, sourceLocator
    }));
    if (balanceAfter !== null) {
      result.balanceSnapshots.push({ accountId, balance: balanceAfter, statementDate: transactionDate, source: 'dbs-csv', sourceFile, sourceLocator });
    }
  });
  const dates = result.transactions.map((transaction) => transaction.transactionDate).filter(Boolean).sort();
  if (dates.length > 0) result.coverageIntervals = [{ accountId, startDate: dates[0], endDate: metadata.statementDate && metadata.statementDate > dates.at(-1) ? metadata.statementDate : dates.at(-1), source: 'dbs-csv', sourceFile }];
  return result;
}

function readMetadata(rows) {
  const metadata = { accountName: null, accountNumber: null, currentBalance: null, ledgerBalance: null, statementDate: null, currentBalanceRow: null };
  rows.forEach((row, index) => {
    const key = normaliseHeader(row[0]);
    const value = row.slice(1).find((cell) => cell?.trim())?.trim();
    if (!value) return;
    const accountNumber = value.match(/\b\d{3}-\d{4,}-\d+\b/)?.[0];
    if (/^account (name|holder)$/.test(key)) metadata.accountName = value;
    if (/^statement as at$/.test(key)) metadata.statementDate = toIsoDate(value);
    if (/^ledger balance$/.test(key)) metadata.ledgerBalance = parseAmount(value);
    if (/^account (number|no)$/.test(key)) metadata.accountNumber = value;
    if (/^account details for$/.test(key) && accountNumber) {
      metadata.accountNumber = accountNumber;
      metadata.accountName = value.replace(accountNumber, '').trim();
    }
    if (/^(current|available|closing) balance$/.test(key)) {
      metadata.currentBalance ??= parseAmount(value);
      metadata.currentBalanceRow ??= index + 1;
    }
  });
  return metadata;
}
