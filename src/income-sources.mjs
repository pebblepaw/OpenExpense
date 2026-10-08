import { incomeSourceRules, knownIncomePatterns } from './config.mjs';
import { normaliseDescription } from './ledger.mjs';

export function incomeSourceFor(transaction, { rules = incomeSourceRules, knownPatterns = knownIncomePatterns } = {}) {
  if (transaction.role !== 'income' || Number(transaction.amountSgd) <= 0) return null;
  const description = normaliseDescription(transaction.descriptionRaw);
  const match = rules.find(({ pattern }) => description.includes(normaliseDescription(pattern)));
  return match?.name ?? knownPatterns.find(pattern => description.includes(normaliseDescription(pattern))) ?? 'Other income';
}
