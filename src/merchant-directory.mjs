import { normaliseDescription } from './ledger.mjs';
import { readFile } from 'node:fs/promises';
import { categories, paths } from './config.mjs';
import { parseCsv } from './csv.mjs';

export async function loadMerchantDirectory(path = paths.merchantDirectory) {
  try {
    const [headers = [], ...rows] = parseCsv(await readFile(path, 'utf8'));
    const indexes = new Map(headers.map((header, index) => [String(header).trim(), index]));
    return new Map(rows
      .map((row) => {
        const merchantKey = String(row[indexes.get('merchantKey')] ?? '').trim();
        const category = String(row[indexes.get('category')] ?? '').trim();
        if (!merchantKey || !categories.includes(category)) return null;
        return [merchantKey, {
          displayName: valueAt(row, indexes, 'displayName'),
          category,
          subcategory: valueAt(row, indexes, 'subcategory'),
          confidence: valueAt(row, indexes, 'confidence'),
          sourceUrl: valueAt(row, indexes, 'sourceUrl'),
          notes: valueAt(row, indexes, 'notes')
        }];
      })
      .filter(Boolean));
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
}

export function merchantKeyFor(descriptionRaw) {
  let merchant = String(descriptionRaw ?? '').trim();
  if (!merchant || /\b(?:SEND MONEY TO|RECEIVE MONEY FROM|ADVICE FUNDS TRANSFER|I-BANK)\b/i.test(merchant)) return null;
  const payNowBusiness = merchant.match(/\bTo:\s*(.+?)\s+OTHR\b/i);
  if (payNowBusiness) merchant = payNowBusiness[1];
  merchant = merchant.replace(/^Debit Card Transaction\s*—\s*/i, '');
  merchant = merchant.replace(/^BAT\s+/i, '');
  merchant = merchant.replace(/\s+—\s+Point-of-Sale Transaction.*$/i, '');
  merchant = merchant.replace(/\s+\d{4}-\d{4}-\d{4}-\d{4}\s+\d+.*$/i, '');
  merchant = merchant.replace(/\s+SINGAPORE\s+SGP\s+\d{1,2}[A-Z]{3}.*$/i, '');
  merchant = merchant.replace(/\s+(?:SI\s+)?(?:SGP|USA|GBR|MYS|VNM|IRL|AUS|JPN|THA|IDN|KOR|CHN)\s+\d{1,2}[A-Z]{3}.*$/i, '');
  merchant = merchant.replace(/\s+/g, ' ').trim();
  if (!merchant || /^PAYNOW\s+(?:TRANSFER|TO)\b/i.test(merchant)) return null;
  return normaliseDescription(merchant) || null;
}

export function buildMerchantDirectory(transactions, researched = new Map()) {
  const grouped = new Map();
  for (const transaction of transactions) {
    if (transaction.role !== 'expense' || Number(transaction.amountSgd) >= 0) continue;
    const merchantKey = merchantKeyFor(transaction.descriptionRaw);
    if (!merchantKey) continue;
    const entry = grouped.get(merchantKey) ?? {
      merchantKey,
      transactionCount: 0,
      totalSpendSgd: 0,
      exampleDescription: transaction.descriptionRaw,
      observedCategories: new Set()
    };
    entry.transactionCount += 1;
    entry.totalSpendSgd += Math.abs(Number(transaction.amountSgd));
    if (transaction.categoryAuto && transaction.categoryAuto !== 'Uncategorized') entry.observedCategories.add(transaction.categoryAuto);
    grouped.set(merchantKey, entry);
  }
  return [...grouped.values()]
    .map((entry) => {
    const research = merchantDirectoryEntryFor(entry.merchantKey, researched) ?? {};
      const observedCategory = entry.observedCategories.size === 1 ? [...entry.observedCategories][0] : null;
      const category = research.category ?? observedCategory ?? 'Uncategorized';
      return {
        merchantKey: entry.merchantKey,
        displayName: research.displayName ?? entry.merchantKey,
        category,
        subcategory: research.subcategory ?? null,
        confidence: research.confidence ?? null,
        sourceUrl: research.sourceUrl ?? null,
        notes: research.notes ?? null,
        reviewStatus: category === 'Uncategorized' ? 'needs_review' : 'reviewed',
        transactionCount: entry.transactionCount,
        totalSpendSgd: Number(entry.totalSpendSgd.toFixed(2)),
        exampleDescription: entry.exampleDescription
      };
    })
    .sort((left, right) => right.totalSpendSgd - left.totalSpendSgd || left.merchantKey.localeCompare(right.merchantKey));
}

export function merchantDirectoryEntryFor(merchantKey, directory = new Map()) {
  const normalisedKey = normaliseDescription(merchantKey);
  const exact = directory.get(normalisedKey);
  if (exact) return exact;
  const candidates = [...directory.entries()]
    .map(([candidate, entry]) => [normaliseDescription(candidate), entry])
    .filter(([candidate]) => candidate.length >= 3 && normalisedKey.startsWith(`${candidate} `))
    .sort(([left], [right]) => right.length - left.length);
  return candidates[0]?.[1] ?? null;
}

function valueAt(row, indexes, key) {
  const value = row[indexes.get(key)];
  return value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
}
