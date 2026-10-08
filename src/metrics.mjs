import { relationshipAccount, settings, categoryName, closingBalanceFor, accountNameFor } from './config.mjs';

const EXPENSE_ROLES = new Set(['expense', 'transfer_to_person', 'paylah_pending_wallet', 'relationship_transfer']);
const OFFSET_ROLES = new Set(['peer_receipt', 'refund']);

export function buildBalanceSeries({ transactions = [], accountMetadata = [], coverage = {}, latestDate, startDate = settings.analysis.start_date } = {}) {
  if (!latestDate) return [];
  const accounts = new Map();
  const datedAccounts = accountMetadata
    .filter((account) => account.source === 'dbs-csv' && account.accountId !== relationshipAccount.accountId && account.currentBalance !== null && account.currentBalance !== undefined && Number.isFinite(Number(account.currentBalance)))
    .sort((left, right) => String(right.statementDate ?? '').localeCompare(String(left.statementDate ?? '')));
  for (const account of datedAccounts) if (!accounts.has(account.accountId)) accounts.set(account.accountId, {
    balanceSgd: closingBalanceFor(account) ?? Number(account.currentBalance), anchorDate: account.statementDate ?? latestDate, assumed: closingBalanceFor(account) !== null
  });
  for (const account of accountMetadata.filter((entry) => ['paylah-pdf', 'revolut-csv'].includes(entry.source))) {
    if (!accounts.has(account.accountId)) accounts.set(account.accountId, { balanceSgd: closingBalanceFor(account) ?? Number(account.currentBalance ?? 0), anchorDate: latestDate, assumed: closingBalanceFor(account) !== null });
  }
  if (accounts.size === 0) return [];

  const rowsByAccount = new Map();
  for (const transaction of transactions) {
    if (transaction.source === 'derived-paylah' || !accounts.has(transaction.accountId) || !Number.isFinite(Number(transaction.amountSgd))) continue;
    const rows = rowsByAccount.get(transaction.accountId) ?? [];
    rows.push(transaction);
    rowsByAccount.set(transaction.accountId, rows);
  }
  const series = [];
  for (let month = startDate.slice(0, 7); month <= latestDate.slice(0, 7); month = nextMonth(month)) {
    const monthEnd = lastDayOfMonth(month);
    const asOfDate = monthEnd > latestDate ? latestDate : monthEnd;
    let balanceSgd = 0;
    const estimatedAccounts = [];
    for (const [accountId, anchor] of accounts) {
      const rows = rowsByAccount.get(accountId) ?? [];
      const movement = rows
        .filter((row) => anchor.anchorDate <= asOfDate
          ? row.transactionDate > anchor.anchorDate && row.transactionDate <= asOfDate
          : row.transactionDate > asOfDate && row.transactionDate <= anchor.anchorDate)
        .reduce((sum, row) => sum + Number(row.amountSgd), 0);
      balanceSgd += anchor.balanceSgd + (anchor.anchorDate <= asOfDate ? movement : -movement);
      const lower = anchor.anchorDate < asOfDate ? anchor.anchorDate : asOfDate;
      const upper = anchor.anchorDate > asOfDate ? anchor.anchorDate : asOfDate;
      if ((coverage.gaps ?? []).some((gap) => gap.accountId === accountId && gap.startDate <= upper && gap.endDate > lower)) estimatedAccounts.push(accountId);
    }
    series.push({ month, asOfDate, balanceSgd: Math.round(balanceSgd * 100) / 100, estimated: estimatedAccounts.length > 0, estimatedAccounts, partial: asOfDate !== monthEnd });
  }
  return series;
}

export function deriveDbsBaseline({ transactions, accountMetadata, coverage = { gaps: [] } }, cutoffDate = settings.analysis.baseline_date) {
  const seen = new Set();
  const accounts = accountMetadata
    .filter((account) => account.source === 'dbs-csv' && account.currentBalance != null && Number.isFinite(Number(account.currentBalance)) && account.accountId !== relationshipAccount.accountId)
    .sort((a, b) => String(b.statementDate ?? '').localeCompare(String(a.statementDate ?? '')))
    .filter((account) => !seen.has(account.accountId) && seen.add(account.accountId))
    .map((account) => {
      const postCutoffMovementSgd = transactions
        .filter((transaction) => transaction.accountId === account.accountId && transaction.transactionDate > cutoffDate)
        .reduce((sum, transaction) => sum + Number(transaction.amountSgd ?? 0), 0);
      const estimated = (coverage.gaps ?? []).some((gap) => gap.accountId === account.accountId && gap.endDate > cutoffDate);
      return {
        accountId: account.accountId,
        accountName: accountNameFor(account),
        currentBalanceSgd: closingBalanceFor(account) ?? Number(account.currentBalance),
        postCutoffMovementSgd,
        baselineBalanceSgd: (closingBalanceFor(account) ?? Number(account.currentBalance)) - postCutoffMovementSgd,
        estimated
      };
    });
  const configuredWalletBalances = new Map(accountMetadata.filter(account => account.accountId !== relationshipAccount.accountId && account.source !== 'dbs-csv' && closingBalanceFor(account) !== null).map(account => [account.accountId,closingBalanceFor(account)]));
  return {
    cutoffDate,
    accounts,
    balanceSgd: accounts.reduce((sum, account) => sum + account.baselineBalanceSgd, 0) + [...configuredWalletBalances.values()].reduce((sum,balance) => sum + balance,0),
    estimated: accounts.some((account) => account.estimated)
  };
}

export function buildDashboardMetrics(transactions, {
  baselineBalanceSgd = 0,
  baselineDate = settings.analysis.baseline_date,
  recurringIncomeSgd,
  recurringSpendSgd,
  oneOffAdjustments = [],
  forecastFromDate = null,
  balanceSeries = []
} = {}) {
  const buckets = new Map();
  for (const transaction of transactions) {
    const month = String(transaction.transactionDate ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const bucket = buckets.get(month) ?? emptyMonth(month);
    const amount = Number(transaction.amountSgd ?? 0);
    if (transaction.role === 'income') bucket.netIncomeSgd += Math.max(0, amount);
    if (EXPENSE_ROLES.has(transaction.role)) {
      const spend = Math.abs(amount);
      bucket.grossSpendSgd += spend;
      bucket.netPersonalSpendSgd += spend;
      const category = transaction.category ?? categoryName('uncategorized');
      bucket.categories[category] = (bucket.categories[category] ?? 0) + spend;
    }
    if (OFFSET_ROLES.has(transaction.role)) {
      const offset = Math.abs(amount);
      bucket.reimbursementsSgd += offset;
      bucket.netPersonalSpendSgd -= offset;
    }
    buckets.set(month, bucket);
  }
  const months = [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const month of months) month.savedSgd = month.netIncomeSgd - month.netPersonalSpendSgd;
  const savedByMonth = new Map(months.map((month) => [month.month, month.savedSgd]));
  const enrichedBalanceSeries = balanceSeries.map((entry, index) => ({
    ...entry,
    savedSgd: savedByMonth.get(entry.month) ?? 0,
    balanceChangeSgd: index === 0 ? null : entry.balanceSgd - balanceSeries[index - 1].balanceSgd
  }));
  const balanceByMonth = new Map(enrichedBalanceSeries.map((entry) => [entry.month, entry]));
  const categoryNames = [...new Set(months.flatMap((month) => Object.keys(month.categories)))].sort();
  const categorySeries = categoryNames.map((category) => ({
    category,
    months: months.map((month, index) => {
      const amountSgd = Number(month.categories[category] ?? 0);
      const previousMonthAmountSgd = index === 0 ? null : Number(months[index - 1].categories[category] ?? 0);
      return { month: month.month, amountSgd, changeSgd: previousMonthAmountSgd === null ? null : amountSgd - previousMonthAmountSgd };
    })
  }));
  const monthlyMetricsRows = months.flatMap((month, index) => {
    const previous = months[index - 1];
    const metricRows = [
      metricRow(month, previous, 'Net income', null, month.netIncomeSgd, previous?.netIncomeSgd),
      metricRow(month, previous, 'Gross spend', null, month.grossSpendSgd, previous?.grossSpendSgd),
      metricRow(month, previous, 'Reimbursements', null, month.reimbursementsSgd, previous?.reimbursementsSgd),
      metricRow(month, previous, 'Net personal spend', null, month.netPersonalSpendSgd, previous?.netPersonalSpendSgd),
      metricRow(month, previous, 'Net saved', null, month.savedSgd, previous?.savedSgd)
    ];
    const balance = balanceByMonth.get(month.month);
    if (balance) metricRows.push({ ...metricRow(month, previous, 'End balance', null, balance.balanceSgd, balanceByMonth.get(previous?.month)?.balanceSgd), notes: balance.estimated ? `Estimated due to source gaps: ${balance.estimatedAccounts.join(', ')}` : balance.partial ? `Partial month through ${balance.asOfDate}` : 'Combined account balance; wallet closing balances assumed S$0.' });
    return [...metricRows, ...categoryNames.map((category) => metricRow(month, previous, 'Category spend', category, month.categories[category] ?? 0, previous?.categories[category] ?? 0))];
  });
  const completedThrough = forecastFromDate ? previousMonth(forecastFromDate.slice(0, 7)) : baselineDate.slice(0,7);
  const jobMonths = months.filter(({ month }) => month >= (settings.forecast.income_average_start_month ?? settings.analysis.start_date.slice(0,7)) && month <= completedThrough).slice(-settings.forecast.recent_months);
  const average = (field, fallback = 0) => jobMonths.length ? jobMonths.reduce((sum, row) => sum + row[field], 0) / jobMonths.length : fallback;
  const projectedIncome = recurringIncomeSgd ?? average('netIncomeSgd');
  const projectedSpend = recurringSpendSgd ?? average('netPersonalSpendSgd');
  const projectedMonths = [];
  const target = settings.forecast.target_month ?? `${(forecastFromDate ?? baselineDate).slice(0,4)}-12`;
  for (let month = forecastFromDate?.slice(0,7) ?? nextMonth(baselineDate.slice(0,7)); month <= target; month = nextMonth(month)) projectedMonths.push(month);
  let runningBalance = Number(baselineBalanceSgd);
  const forecast = projectedMonths.map((month) => {
    const partial = forecastFromDate && month === forecastFromDate.slice(0, 7);
    const remainingFraction = partial ? Math.max(0, (daysInMonth(month) - Number(forecastFromDate.slice(8))) / daysInMonth(month)) : 1;
    const spend = projectedSpend * remainingFraction;
    // Project only income not yet received; early-month exports may precede payday.
    const receivedIncome = buckets.get(month)?.netIncomeSgd ?? 0;
    const income = partial ? Math.max(0, projectedIncome - receivedIncome) : projectedIncome;
    const adjustment = oneOffAdjustments.filter((entry) => entry.month === month).reduce((sum, entry) => sum + Number(entry.amountSgd ?? 0), 0);
    runningBalance += income - spend + adjustment;
    return { month, incomeSgd: income, spendSgd: spend, adjustmentSgd: adjustment, projectedBalanceSgd: runningBalance };
  });
  return { months, balanceSeries: enrichedBalanceSeries, categorySeries, monthlyMetricsRows, baselineBalanceSgd: Number(baselineBalanceSgd), baselineDate, forecast, projectedYearEndBalanceSgd: runningBalance };
}

function nextMonth(month) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}

function lastDayOfMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function previousMonth(month) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function daysInMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

function metricRow(month, previous, metric, category, amountSgd, previousMonthAmountSgd) {
  const previousAmount = previous ? Number(previousMonthAmountSgd ?? 0) : null;
  const amount = Number(amountSgd ?? 0);
  return {
    month: month.month,
    metric,
    category,
    amountSgd: amount,
    previousMonthAmountSgd: previousAmount,
    changeSgd: previousAmount === null ? null : amount - previousAmount,
    changePct: previousAmount === null || previousAmount === 0 ? null : (amount - previousAmount) / previousAmount
  };
}

function emptyMonth(month) {
  return { month, netIncomeSgd: 0, grossSpendSgd: 0, reimbursementsSgd: 0, netPersonalSpendSgd: 0, categories: {} };
}
