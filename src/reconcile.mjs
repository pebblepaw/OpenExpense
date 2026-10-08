import { revolutAccountPatterns, transferMatching } from './config.mjs';
import { normaliseDescription } from './ledger.mjs';

function isRevolutAccountTransfer(description) {
  return (revolutAccountPatterns ?? []).some((pattern) => pattern && description.includes(normaliseDescription(pattern)));
}

export function reconcileTransactions(transactions, {
  ownedAccountIds = [...new Set(transactions.map(({ accountId }) => accountId).filter(Boolean))],
  paylahAccountId = ownedAccountIds.find((accountId) => /paylah/i.test(accountId)),
  lastDetailedPayLahDate,
  cutoffWalletBalance = 0,
  confirmedClosingBalance = 0,
  detailedPayLahThrough,
  maxCalendarDays = transferMatching.maxCalendarDays,
  amountToleranceSgd = transferMatching.amountToleranceSgd
} = {}) {
  const owned = new Set(ownedAccountIds);
  let reconciled = transactions.map((transaction) => ({ ...transaction }));
  const candidates = reconciled.filter((transaction) => owned.has(transaction.accountId) && isTransferCandidate(transaction, owned));
  const transferMatches = findTransferMatches(candidates, { maxCalendarDays, amountToleranceSgd });

  for (const match of transferMatches) {
    reconciled = reconciled.map((transaction) => match.sourceIds.includes(transaction.id)
      ? markInternal(transaction, match.sourceIds.filter((id) => id !== transaction.id), match.id)
      : transaction);
  }

  const pending = reconcilePendingPayLah(reconciled, {
    owned,
    paylahAccountId,
    lastDetailedPayLahDate,
    cutoffWalletBalance,
    confirmedClosingBalance,
    detailedPayLahThrough
  });
  reconciled = pending.transactions;

  const matchedIds = new Set(transferMatches.flatMap(({ sourceIds }) => sourceIds));
  reconciled = reconciled.map((transaction) => {
    if (!owned.has(transaction.accountId) || !isTransferCandidate(transaction, owned)) return transaction;
    if (matchedIds.has(transaction.id) || transaction.roleAuto === 'internal_transfer' || transaction.role === 'internal_transfer') return transaction;
    if (isRevolutAccountTransfer(normaliseDescription(transaction.descriptionRaw))) {
      return markInternal(transaction, [], 'revolut-owned-account');
    }
    return {
      ...transaction,
      reviewStatus: 'needs_review',
      reviewNote: transaction.reviewNote ?? 'Unmatched owned-account transfer candidate'
    };
  });

  return { transactions: reconciled, transferMatches, ...pending.metadata };
}

function findTransferMatches(candidates, { maxCalendarDays, amountToleranceSgd }) {
  const matches = [];
  const used = new Set();
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    if (used.has(left.id) || left.amountSgd === null) continue;
    let best = null;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];
      if (used.has(right.id) || right.accountId === left.accountId || right.amountSgd === null) continue;
      const amountDifference = Math.abs(left.amountSgd + right.amountSgd);
      const calendarDays = dateDistance(left.transactionDate, right.transactionDate);
      const tolerance = isApplePayRevolutPair(left, right) ? Math.max(amountToleranceSgd, 0.99) : amountToleranceSgd;
      if (amountDifference > tolerance + 1e-9 || calendarDays > maxCalendarDays) continue;
      const score = [calendarDays, amountDifference, right.transactionDate ?? '', right.id].join('|');
      if (!best || score < best.score) best = { right, score };
    }
    if (!best) continue;
    used.add(left.id);
    used.add(best.right.id);
    matches.push({
      id: `internal:${[left.id, best.right.id].sort().join(':')}`,
      sourceIds: [left.id, best.right.id],
      amountSgd: Math.abs(left.amountSgd),
      calendarDays: dateDistance(left.transactionDate, best.right.transactionDate)
    });
  }
  return matches;
}

function reconcilePendingPayLah(transactions, {
  owned,
  paylahAccountId,
  lastDetailedPayLahDate,
  cutoffWalletBalance,
  confirmedClosingBalance,
  detailedPayLahThrough
}) {
  const existingPending = transactions.filter(isPendingWalletRow);
  let remaining = transactions.filter((transaction) => !isPendingWalletRow(transaction));
  if (!paylahAccountId || !lastDetailedPayLahDate) return { transactions: remaining, metadata: {} };

  const topups = remaining.filter((transaction) => transaction.transactionDate > lastDetailedPayLahDate
    && transaction.accountId !== paylahAccountId
    && owned.has(transaction.accountId)
    && transaction.amountSgd < 0
    && isPayLahTopup(transaction));
  const walletReturns = remaining.filter((transaction) => transaction.transactionDate > lastDetailedPayLahDate
    && transaction.accountId === paylahAccountId
    && transaction.amountSgd < 0
    && isPayLahToOwnedTransfer(transaction));
  const linkedSourceIds = [...topups, ...walletReturns].map(({ id }) => id);
  const lastPendingDate = [...topups, ...walletReturns].map(({ transactionDate }) => transactionDate).sort().at(-1);
  const coverageReplacesPending = Boolean(detailedPayLahThrough && lastPendingDate && detailedPayLahThrough >= lastPendingDate);

  if (coverageReplacesPending) {
    return {
      transactions: remaining,
      metadata: {
        pendingWalletReplacement: {
          replacedSourceIds: unique([...existingPending.flatMap(({ linkedSourceIds: ids = [] }) => ids), ...linkedSourceIds])
        }
      }
    };
  }
  if (linkedSourceIds.length === 0) return { transactions: remaining, metadata: {} };

  const topupTotal = sumMagnitude(topups);
  const walletReturnTotal = sumMagnitude(walletReturns);
  remaining = remaining.map((transaction) => {
    const linked = linkedSourceIds.includes(transaction.id);
    return linked ? markInternal(transaction, [], 'paylah-pending-wallet') : transaction;
  });
  const netPersonalSpend = Number(cutoffWalletBalance) + topupTotal - Number(confirmedClosingBalance) - walletReturnTotal;
  const synthetic = {
    id: `synthetic:paylah-pending:${lastDetailedPayLahDate}:${lastPendingDate}`,
    fingerprint: `synthetic:paylah-pending:${lastDetailedPayLahDate}:${lastPendingDate}`,
    source: 'reconcile',
    sourceFile: null,
    accountId: paylahAccountId,
    transactionDate: lastPendingDate,
    postedDate: lastPendingDate,
    descriptionRaw: 'PayLah wallet — statement pending',
    amountSgd: -netPersonalSpend,
    direction: netPersonalSpend < 0 ? 'inflow' : 'outflow',
    roleAuto: 'paylah_pending_wallet',
    role: 'paylah_pending_wallet',
    categoryAuto: null,
    category: null,
    subcategoryAuto: null,
    subcategory: null,
    manualCategory: null,
    manualSubcategory: null,
    manualRole: null,
    reviewStatus: 'needs_review',
    reviewNote: 'PayLah statement pending; calculated from linked funding and return transfers',
    netPersonalSpendOffsetSgd: 0,
    linkedSourceIds,
    synthetic: true,
    syntheticType: 'paylah_pending_wallet'
  };
  return { transactions: [...remaining, synthetic], metadata: { pendingWallet: synthetic } };
}

function markInternal(transaction, linkedSourceIds, reconciliationId) {
  return {
    ...transaction,
    roleAuto: 'internal_transfer',
    role: transaction.manualRole || 'internal_transfer',
    categoryAuto: null,
    category: transaction.manualCategory || null,
    subcategoryAuto: null,
    subcategory: transaction.manualSubcategory || null,
    linkedSourceIds: unique([...(transaction.linkedSourceIds ?? []), ...linkedSourceIds]),
    reconciliationId,
    reviewStatus: transaction.manualRole || transaction.manualCategory ? transaction.reviewStatus : null,
    reviewNote: transaction.manualRole || transaction.manualCategory ? transaction.reviewNote : null,
    netPersonalSpendOffsetSgd: 0
  };
}

function isTransferCandidate(transaction, owned) {
  const description = normaliseDescription(transaction.descriptionRaw);
  if (!description) return false;
  if (isPayLahTopup(transaction) || /\b(?:APPLE PAY TOP UP|REVOLUT|OWN ACCOUNT)\b/.test(description) || isRevolutAccountTransfer(description)) return true;
  if (/\b(?:TRANSFER|TRF|TOP UP|PAYMENT FROM)\b/.test(description)) return true;
  const compactDescription = description.replace(/[^A-Z0-9]/g, '');
  return [...owned].some((accountId) => accountId !== transaction.accountId
    && compactDescription.includes(String(accountId).replace(/[^A-Z0-9]/gi, '').toUpperCase()));
}

function isApplePayRevolutPair(left, right) {
  const descriptions = [left, right].map((transaction) => normaliseDescription(transaction.descriptionRaw));
  const accounts = [left.accountId, right.accountId];
  return accounts.some((accountId) => /revolut/i.test(accountId))
    && descriptions.some((description) => /\bAPPLE PAY TOP UP\b/.test(description));
}

function isPayLahTopup(transaction) {
  return /\b(?:TOP UP TO PAYLAH|PAYLAH TOP UP)\b/.test(normaliseDescription(transaction.descriptionRaw));
}

function isPayLahToOwnedTransfer(transaction) {
  return /\b(?:TRANSFER|SEND)\b.*\b(?:TO|INTO)\b.*\b(?:DBS|POSB|BANK|ACCOUNT)\b/.test(normaliseDescription(transaction.descriptionRaw));
}

function isPendingWalletRow(transaction) {
  return transaction.syntheticType === 'paylah_pending_wallet' || transaction.role === 'paylah_pending_wallet';
}

function sumMagnitude(transactions) {
  return transactions.reduce((sum, transaction) => sum + Math.abs(Number(transaction.amountSgd ?? 0)), 0);
}

function dateDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.abs((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86400000);
}

function unique(values) {
  return [...new Set(values)];
}
