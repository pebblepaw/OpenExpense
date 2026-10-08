import { normalisedTransaction } from './ledger.mjs';
import { categoryName } from './config.mjs';

export function buildProvisionalPaylahRow({ transactions = [], coverage = {} } = {}) {
  const latestDate = coverage.latestDate;
  const statements = (coverage.intervals ?? [])
    .filter((interval) => interval.source === 'paylah-pdf' && interval.accountId && interval.endDate)
    .sort((left, right) => right.endDate.localeCompare(left.endDate));
  const latestStatement = statements[0];
  if (!latestDate || !latestStatement || latestStatement.endDate >= latestDate) return null;

  const topups = transactions.filter((transaction) =>
    ['dbs-csv', 'dbs-pdf'].includes(transaction.source)
    && transaction.role === 'internal_transfer'
    && transaction.transactionDate > latestStatement.endDate
    && transaction.transactionDate <= latestDate
    && Number(transaction.amountSgd) < 0
    && /\bTOP[ -]?UP TO PAYLAH\b/i.test(transaction.descriptionRaw ?? ''));
  const amountSgd = -Math.round(topups.reduce((sum, transaction) => sum + Math.abs(Number(transaction.amountSgd)), 0) * 100) / 100;
  if (amountSgd === 0) return null;

  const descriptionRaw = `PayLah spending inferred from bank top-ups after ${latestStatement.endDate}; detailed statement pending`;
  const row = normalisedTransaction({
    source: 'derived-paylah',
    sourceFile: 'DBS/POSB top-ups',
    accountId: latestStatement.accountId,
    transactionDate: latestDate,
    postedDate: latestDate,
    descriptionRaw,
    amountSgd,
    balanceAfter: null,
    sourceLocator: { afterDate: latestStatement.endDate, bankTransactionIds: topups.map((transaction) => transaction.id) }
  });
  return {
    ...row,
    roleAuto: 'paylah_pending_wallet',
    categoryAuto: categoryName('pending_paylah'),
    role: 'paylah_pending_wallet',
    category: categoryName('pending_paylah'),
    reviewStatus: 'awaiting_statement',
    reviewNote: `Provisional net spending inferred from ${topups.length} DBS/POSB PayLah top-ups; replace when a detailed PayLah statement arrives.`
  };
}
