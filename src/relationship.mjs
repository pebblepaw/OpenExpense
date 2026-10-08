import { relationshipAccount, categoryName, canonicalCategory } from './config.mjs';
import { normaliseDescription } from './ledger.mjs';

export function applyRelationshipScope(transactions, config = relationshipAccount) {
  const { accountId: jointAccountId, personalFundingAccountIds = [] } = config;
  return transactions.map((transaction) => {
    const description = normaliseDescription(transaction.descriptionRaw);
    const amount = Number(transaction.amountSgd ?? 0);
    if (transaction.accountId === jointAccountId) {
      if (amount > 0) {
        const fundingSource = personalFundingAccountIds.find((id) => description.includes(normaliseDescription(id)));
        const userLabel = config.userLabel || 'You';
        const partnerPatterns = (config.partnerFundingAccountIds ?? []).map((id) => normaliseDescription(id));
        const isPartnerFunding = partnerPatterns.some((pattern) => pattern && description.includes(pattern));
        return {
          ...transaction,
          roleAuto: 'relationship_contribution',
          role: transaction.manualRole || 'relationship_contribution',
          categoryAuto: null,
          category: transaction.manualCategory || null,
          contributionSource: fundingSource ? userLabel : config.otherContributorLabel ?? relationshipAccount.otherContributorLabel,
          reviewStatus: fundingSource || isPartnerFunding ? null : 'needs_review',
          reviewNote: fundingSource || isPartnerFunding ? null : 'Unidentified relationship-account contribution',
          netPersonalSpendOffsetSgd: 0
        };
      }
      return { ...transaction, accountScope: 'relationship' };
    }
    if (amount < 0 && description.includes(normaliseDescription(jointAccountId))) {
      return {
        ...transaction,
        roleAuto: 'relationship_transfer',
        role: transaction.manualRole || 'relationship_transfer',
        categoryAuto: categoryName('relationship_transfer'),
        category: transaction.manualCategory || categoryName('relationship_transfer'),
        reviewStatus: null,
        reviewNote: transaction.reviewNote === 'Unmatched owned-account transfer candidate' ? null : transaction.reviewNote,
        accountScope: 'personal'
      };
    }
    return { ...transaction, accountScope: 'personal' };
  }).map((transaction) => transaction.accountId === jointAccountId ? { ...transaction, accountScope: 'relationship' } : transaction);
}

export function buildRelationshipMetrics(transactions, accountMetadata = [], config = relationshipAccount) {
  const jointAccountId = config.accountId;
  const rows = transactions.filter((transaction) => transaction.accountId === jointAccountId);
  const metadata = accountMetadata
    .filter((account) => account.accountId === jointAccountId && account.source === 'dbs-csv')
    .sort((a, b) => String(b.statementDate ?? '').localeCompare(String(a.statementDate ?? '')))[0];
  const monthly = new Map();
  for (const row of rows) {
    const month = String(row.transactionDate ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const bucket = monthly.get(month) ?? { month, spendSgd: 0, userFundingSgd: 0, partnerFundingSgd: 0, categories: {} };
    const amount = Number(row.amountSgd ?? 0);
    if (amount > 0 && row.role === 'relationship_contribution') {
      const userLabel = config.userLabel || 'You';
      if (row.contributionSource === userLabel || row.contributionSource === 'You') bucket.userFundingSgd += amount;
      else bucket.partnerFundingSgd += amount;
    } else if (amount < 0 && row.role !== 'internal_transfer') {
      const spend = Math.abs(amount);
      bucket.spendSgd += spend;
      const category = row.category ?? categoryName('uncategorized');
      bucket.categories[category] = (bucket.categories[category] ?? 0) + spend;
    }
    monthly.set(month, bucket);
  }
  return {
    accountName: config.accountName,
    accountId: jointAccountId,
    userLabel: config.userLabel || 'You',
    partnerLabel: config.partnerLabel || 'Partner',
    statementDate: metadata?.statementDate ?? null,
    availableBalanceSgd: metadata?.currentBalance ?? null,
    ledgerBalanceSgd: metadata?.ledgerBalance ?? null,
    months: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    transactions: rows.sort((a, b) => String(b.transactionDate).localeCompare(String(a.transactionDate)))
  };
}
