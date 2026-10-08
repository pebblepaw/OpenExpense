import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dateWithStatementYear, normalisedTransaction, parseAmount, toIsoDate } from '../ledger.mjs';

const execFileAsync = promisify(execFile);

export async function parsePayLahPdf(filePath, { pdfToText = readPdfText, sourceFile = filePath, ...options } = {}) {
  return parsePayLahPdfText(await pdfToText(filePath), { sourceFile, ...options });
}

export function parsePayLahPdfText(text, { sourceFile, accountId: requestedAccountId } = {}) {
  const lines = text.split(/\r?\n/);
  const statementDate = toIsoDate(text.match(/STATEMENT DATE[\s\S]{0,160}?(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/i)?.[1]);
  const walletHeaderValues = text.match(/WALLET ACCOUNT\s*\n([^\n]+)/i)?.[1] ?? '';
  const walletNumber = text.match(/PayLah!\s+Wallet\s+No\.\s*(\d+)/i)?.[1]
    ?? [...walletHeaderValues.matchAll(/\b\d{10,}\b/g)].at(-1)?.[0];
  const accountId = requestedAccountId ?? (walletNumber ? `paylah-${walletNumber}` : 'paylah-wallet');
  const closingBalance = parseAmount(text.match(/(?:Closing|Available) Balance\s*:\s*(S?\$?[\d,().-]+)/i)?.[1] ?? text.match(/BALANCE CARRIED FORWARD\s+([\d,.]+)\s+CR/i)?.[1]);
  const coverageStart = statementDate ? nextMonthlyStatementStart(statementDate) : null;
  const result = { transactions: [], accountMetadata: [{ accountId, accountName: 'PayLah Wallet', currentBalance: closingBalance, source: 'paylah-pdf', sourceFile }], balanceSnapshots: [], coverageIntervals: coverageStart && statementDate ? [{ accountId, startDate: coverageStart, endDate: statementDate, source: 'paylah-pdf', sourceFile }] : [] };
  if (closingBalance !== null) result.balanceSnapshots.push({ accountId, balance: closingBalance, statementDate, source: 'paylah-pdf', sourceFile, sourceLocator: { line: 1 } });

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?)\s+(.+?)\s+(S?\$?[\d,().-]+)\s+(DB|CR)\s*$/i);
    if (!match) continue;
    const transactionDate = dateWithStatementYear(match[1], statementDate);
    if (!transactionDate) continue;
    const amount = parseAmount(match[3]);
    const amountSgd = match[4].toUpperCase() === 'DB' ? -Math.abs(amount) : Math.abs(amount);
    const reference = lines[index + 1]?.match(/REF\s+NO\s*:\.?\s*([A-Z0-9-]+)/i)?.[1];
    result.transactions.push(normalisedTransaction({
      source: 'paylah-pdf', sourceFile, accountId, transactionDate, postedDate: transactionDate,
      descriptionRaw: match[2], amountSgd, balanceAfter: null, sourceLocator: reference ? { line: index + 1, reference } : { line: index + 1 }
    }));
  }
  if (result.coverageIntervals.length === 0) {
    const dates = result.transactions.map((transaction) => transaction.transactionDate).filter(Boolean).sort();
    if (dates.length > 0) result.coverageIntervals.push({ accountId, startDate: dates[0], endDate: dates.at(-1), source: 'paylah-pdf', sourceFile });
  }
  return result;
}

function nextMonthlyStatementStart(statementDate) {
  const value = new Date(`${statementDate}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - 1);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function readPdfText(filePath) {
  const { stdout } = await execFileAsync('pdftotext', ['-layout', filePath, '-']);
  return stdout;
}
