import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dateWithStatementYear, normalisedTransaction, parseAmount, toIsoDate } from '../ledger.mjs';

const execFileAsync = promisify(execFile);

export async function parseDbsPdf(filePath, { pdfToText = readPdfText, sourceFile = filePath, ...options } = {}) {
  return parseDbsPdfText(await pdfToText(filePath), { sourceFile, ...options });
}

export function parseDbsPdfText(text, { sourceFile, accountId: requestedAccountId } = {}) {
  const lines = text.split(/\r?\n/);
  const accountId = requestedAccountId ?? text.match(/Account\s*(?:Number|No\.?)\s*:\s*([\d -]+)/i)?.[1]?.trim() ?? `dbs:${sourceFile}`;
  const closingBalance = parseAmount(text.match(/(?:Closing|Current) Balance\s*:\s*(S?\$?[\d,().-]+)/i)?.[1]);
  const statementRange = text.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/i);
  const statementStart = toIsoDate(statementRange?.[1]);
  const statementEnd = toIsoDate(statementRange?.[2]);
  const result = { transactions: [], accountMetadata: [{ accountId, accountName: null, currentBalance: closingBalance, source: 'dbs-pdf', sourceFile }], balanceSnapshots: [], coverageIntervals: statementStart && statementEnd ? [{ accountId, startDate: statementStart, endDate: statementEnd, source: 'dbs-pdf', sourceFile }] : [] };
  if (closingBalance !== null) result.balanceSnapshots.push({ accountId, balance: closingBalance, statementDate: null, source: 'dbs-pdf', sourceFile, sourceLocator: { line: 1 } });

  const headerLine = lines.findIndex((line) => (/transaction date/i.test(line) || /^\s*date\s+description/i.test(line)) && /description|particulars|details/i.test(line));
  if (headerLine === -1) return result;
  const tableHeader = lines[headerLine];
  const headers = tableHeader.split('|').map((part) => part.trim());
  const descriptionIndex = headers.findIndex((value) => /description|particulars|details/i.test(value));
  const transactionDateIndex = headers.findIndex((value) => /transaction date|^date$/i.test(value));
  const postedDateIndex = headers.findIndex((value) => /value date|posting date|posted date/i.test(value));
  const debitIndex = headers.findIndex((value) => /debit|withdrawal/i.test(value));
  const creditIndex = headers.findIndex((value) => /credit|deposit/i.test(value));
  const balanceIndex = headers.findIndex((value) => /balance/i.test(value));

  let activeTableHeader = tableHeader;
  let pending = null;
  const flushPending = () => {
    if (!pending) return;
    addTransaction(result, { sourceFile, accountId, ...pending });
    pending = null;
  };
  lines.slice(headerLine + 1).forEach((line, offset) => {
    const row = line.split('|').map((part) => part.trim());
    const sourceLocator = { line: headerLine + offset + 2 };
    if (isRepeatedTableHeader(line)) {
      flushPending();
      activeTableHeader = line;
      return;
    }
    if (isStatementPageMetadata(line)) {
      flushPending();
      return;
    }
    if (headers.length > 1 && row.length === headers.length) {
      const transactionDate = toIsoDate(row[transactionDateIndex]);
      const descriptionRaw = row[descriptionIndex];
      if (!transactionDate || !descriptionRaw) return;
      const debit = parseAmount(row[debitIndex]);
      const credit = parseAmount(row[creditIndex]);
      addTransaction(result, { sourceFile, accountId, transactionDate, postedDate: toIsoDate(row[postedDateIndex]) ?? transactionDate, descriptionRaw, amountSgd: debit !== null ? -Math.abs(debit) : credit !== null ? Math.abs(credit) : null, balanceAfter: parseAmount(row[balanceIndex]), sourceLocator });
      return;
    }
    const plainText = parsePlainTextRow(line);
    if (plainText) {
      flushPending();
      addTransaction(result, { sourceFile, accountId, sourceLocator, ...plainText });
      return;
    }
    const statementRow = parseStatementRow(line, activeTableHeader, statementEnd, sourceLocator);
    if (statementRow) {
      flushPending();
      pending = statementRow;
      return;
    }
    if (pending) appendContinuation(pending, line);
  });
  flushPending();
  if (result.coverageIntervals.length === 0) {
    const dates = result.transactions.map((transaction) => transaction.transactionDate).filter(Boolean).sort();
    if (dates.length > 0) result.coverageIntervals.push({ accountId, startDate: dates[0], endDate: dates.at(-1), source: 'dbs-pdf', sourceFile });
  }
  return result;
}

function isRepeatedTableHeader(line) {
  return /\bDATE\b.*\bDESCRIPTION\b.*\bWITHDRAWAL\b.*\bDEPOSIT\b.*\bBALANCE\b/i.test(line);
}

function isStatementPageMetadata(line) {
  return /^\s*(?:Details of Your|\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+to\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b)/i.test(line);
}

function parseStatementRow(line, header, statementEnd, sourceLocator) {
  const dateMatch = line.match(/^\s*(\d{1,2}\s+[A-Za-z]{3})\s+/);
  if (!dateMatch) return null;
  const withdrawalAt = header.indexOf('WITHDRAWAL');
  const depositAt = header.indexOf('DEPOSIT');
  const balanceAt = header.indexOf('BALANCE');
  if (withdrawalAt < 0 || depositAt < 0 || balanceAt < 0) return null;
  const transactionDate = dateWithStatementYear(dateMatch[1], statementEnd);
  const descriptionRaw = line.slice(dateMatch[0].length, withdrawalAt).trim();
  if (!transactionDate || !descriptionRaw) return null;
  const withdrawal = parseAmount(line.slice(withdrawalAt, depositAt));
  const deposit = parseAmount(line.slice(depositAt, balanceAt));
  const balanceAfter = parseAmount(line.slice(balanceAt));
  return {
    transactionDate,
    postedDate: transactionDate,
    descriptionParts: [descriptionRaw],
    amountSgd: withdrawal !== null ? -Math.abs(withdrawal) : deposit !== null ? Math.abs(deposit) : null,
    balanceAfter,
    sourceLocator
  };
}

function appendContinuation(pending, line) {
  const text = line.trim();
  if (!text || /^(?:Balance (?:Brought|Carried)|CURRENCY |Details of|PAGE |PDS_|CONTINUE|\(REF:|Account No\.|DATE\s+DESCRIPTION)/i.test(text)) return;
  const reference = text.match(/(?:REF\s*(?:NO\.?\s*:\.?\s*)?)?([A-Z]{2,}[A-Z0-9-]{3,}|\d{8,})$/i)?.[1];
  if (reference) {
    pending.sourceLocator = { ...pending.sourceLocator, reference };
    return;
  }
  const valueDate = text.match(/^Value Date\s*:\s*(\d{1,2}\s+[A-Za-z]{3})$/i);
  if (valueDate) {
    pending.postedDate = dateWithStatementYear(valueDate[1], pending.transactionDate) ?? pending.postedDate;
    return;
  }
  if (!/^\d{4}-\d{4}-\d{4}-\d{4}$/.test(text)) pending.descriptionParts.push(text);
}

function parsePlainTextRow(line) {
  const match = line.match(/^\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})\s+(.+?)\s+(S?\$?[\d,().-]+)\s+(DB|CR)\s+(S?\$?[\d,().-]+)\s*$/i);
  if (!match) return null;
  const transactionDate = toIsoDate(match[1]);
  if (!transactionDate) return null;
  const amount = parseAmount(match[4]);
  return {
    transactionDate,
    postedDate: toIsoDate(match[2]) ?? transactionDate,
    descriptionRaw: match[3],
    amountSgd: match[5].toUpperCase() === 'DB' ? -Math.abs(amount) : Math.abs(amount),
    balanceAfter: parseAmount(match[6])
  };
}

function addTransaction(result, fields) {
  const { descriptionParts, ...transactionFields } = fields;
  const transaction = normalisedTransaction({ source: 'dbs-pdf', ...transactionFields, descriptionRaw: descriptionParts ? descriptionParts.join(' — ') : fields.descriptionRaw });
  result.transactions.push(transaction);
  if (transaction.balanceAfter !== null) {
    result.balanceSnapshots.push({
      accountId: transaction.accountId,
      balance: transaction.balanceAfter,
      statementDate: transaction.transactionDate,
      source: transaction.source,
      sourceFile: transaction.sourceFile,
      sourceLocator: transaction.sourceLocator
    });
  }
}

async function readPdfText(filePath) {
  const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-']);
  return stdout;
}
