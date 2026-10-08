import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountHolderPatterns, categories, knownIncomePatterns, revolutAccountPatterns } from './config.mjs';
import { parseCsv } from './csv.mjs';
import { normaliseDescription } from './ledger.mjs';
import { merchantDirectoryEntryFor, merchantKeyFor } from './merchant-directory.mjs';
import { resolveAutomaticSubcategory } from './subcategories.mjs';

const defaultMerchantRulesPath = resolve(dirname(fileURLToPath(import.meta.url)), '../config/merchant_rules.csv');
const incomeAliases = ['GOVERNMENT TECHNOLOGY AGENCY'];

export async function loadMerchantRules(path = defaultMerchantRulesPath) {
  const [headers = [], ...rows] = parseCsv(await readFile(path, 'utf8'));
  const headerIndexes = new Map(headers.map((header, index) => [String(header).trim().toLowerCase(), index]));
  return rows
    .map((row) => ({
      pattern: normaliseDescription(row[headerIndexes.get('pattern')]),
      category: row[headerIndexes.get('category')]?.trim() || null,
      subcategory: row[headerIndexes.get('subcategory')]?.trim() || null,
      role: row[headerIndexes.get('role')]?.trim() || 'expense',
      recurring: /^(true|yes|1)$/i.test(row[headerIndexes.get('recurring')] ?? '')
    }))
    .filter((rule) => rule.pattern && (!rule.category || categories.includes(rule.category)));
}

export async function classifyTransactions(transactions, { rules, directory = new Map() } = {}) {
  const activeRules = rules ?? await loadMerchantRules();
  return transactions.map((transaction) => classifyTransaction(transaction, { rules: activeRules, directory }));
}

export function classifyTransaction(transaction, { rules = [], directory = new Map() } = {}) {
  const description = normaliseDescription(transaction.descriptionRaw);
  const incoming = transaction.amountSgd > 0;
  const outgoing = transaction.amountSgd < 0;
  const merchantKey = outgoing ? merchantKeyFor(transaction.descriptionRaw) : null;
  const directoryEntry = merchantKey ? merchantDirectoryEntryFor(merchantKey, directory) : null;
  const merchantRule = outgoing ? rules.find((rule) => description.includes(rule.pattern)) : null;
  const automatic = automaticClassification({ description, incoming, outgoing, merchantRule, directoryEntry, transaction });
  const manualCategory = optional(transaction.manualCategory);
  const manualSubcategory = optional(transaction.manualSubcategory);
  const manualRole = optional(transaction.manualRole);
  const roleAuto = automatic.roleAuto ?? transaction.roleAuto ?? null;
  const categoryAuto = automatic.categoryAuto ?? null;
  const subcategoryAuto = automatic.subcategoryAuto ?? null;
  const role = manualRole ?? roleAuto ?? (outgoing ? 'expense' : null);
  const category = manualCategory ?? categoryAuto ?? defaultCategoryFor(role, outgoing);
  const resolvedAutomaticSubcategory = resolveAutomaticSubcategory({
    category, amountSgd: transaction.amountSgd, description, suggestedSubcategory: manualCategory && manualCategory !== categoryAuto ? null : subcategoryAuto, role
  });
  const subcategory = manualSubcategory ?? resolvedAutomaticSubcategory;
  const review = automatic.review || transaction.reviewStatus === 'needs_review';
  const reviewNote = optional(transaction.reviewNote) ?? automatic.reviewNote ?? null;

  return {
    ...transaction,
    merchantKey,
    merchantDisplayName: directoryEntry?.displayName ?? null,
    roleAuto,
    categoryAuto,
    subcategoryAuto,
    role,
    category,
    subcategory,
    recurring: Boolean(automatic.recurring || transaction.recurring),
    reviewStatus: review ? 'needs_review' : transaction.reviewStatus ?? null,
    reviewNote,
    netPersonalSpendOffsetSgd: role === 'peer_receipt' || role === 'refund'
      ? -Math.abs(Number(transaction.amountSgd ?? 0))
      : transaction.netPersonalSpendOffsetSgd ?? 0
  };
}

function automaticClassification({ description, incoming, outgoing, merchantRule, directoryEntry, transaction }) {
  if (isInternalTransfer(transaction, description)) return { roleAuto: 'internal_transfer' };
  if (incoming && (isKnownIncome(description) || isInterest(description))) return { roleAuto: 'income' };
  if (incoming && isRefund(description)) return { roleAuto: 'refund' };
  if (incoming && isUnclassifiedTransfer(description)) {
    return { roleAuto: 'peer_receipt', categoryAuto: 'Unclassified Transfers', review: true, reviewNote: 'Unclassified incoming transfer' };
  }
  if (incoming && !isInternalTransfer(transaction, description)) {
    return { roleAuto: 'peer_receipt', review: true, reviewNote: 'Unlinked incoming receipt' };
  }
  if (outgoing && /\bFOMO PAY\b/.test(description)) {
    return { roleAuto: 'transfer_to_person', categoryAuto: 'Unclassified Transfers', review: true, reviewNote: 'Payment processor; underlying merchant unknown' };
  }
  if (directoryEntry?.category && directoryEntry.category !== 'Uncategorized') {
    return {
      roleAuto: 'expense',
      categoryAuto: directoryEntry.category,
      subcategoryAuto: directoryEntry.subcategory ?? null,
      recurring: Boolean(merchantRule?.recurring)
    };
  }
  if (merchantRule) {
    return {
      roleAuto: merchantRule.role,
      categoryAuto: merchantRule.category,
      subcategoryAuto: merchantRule.subcategory,
      recurring: merchantRule.recurring
    };
  }
  if (outgoing && isClearPersonPayment(description)) {
    return { roleAuto: 'transfer_to_person', categoryAuto: 'Transfers to People' };
  }
  if (outgoing && isUnclassifiedTransfer(description)) {
    return { roleAuto: 'transfer_to_person', categoryAuto: 'Unclassified Transfers' };
  }
  if (outgoing && /^TRF\b/.test(description)) {
    return { roleAuto: 'transfer_to_person', categoryAuto: 'Unclassified Transfers', review: true, reviewNote: 'Bank transfer; recipient not identified' };
  }
  if (outgoing && /^SEND MONEY TO\b/.test(description)) {
    return { roleAuto: 'transfer_to_person', categoryAuto: 'Transfers to People' };
  }
  if (outgoing && /\b(?:PROTEIN|CREATINE|GYM|FITNESS|WORKOUT)\b/.test(description)) {
    return { roleAuto: 'expense', categoryAuto: 'Gym', subcategoryAuto: 'Fitness & Supplements' };
  }
  if (outgoing && /\b(?:MOBILE|TELCO|BROADBAND|INTERNET|UTILITY|ELECTRICITY|INSURANCE)\b/.test(description)) {
    return { roleAuto: 'expense', categoryAuto: 'Bills', recurring: true };
  }
  return {};
}

function isKnownIncome(description) {
  return [...knownIncomePatterns, ...incomeAliases].some((pattern) => description.includes(normaliseDescription(pattern)));
}

function isRefund(description) {
  return /\b(?:REFUND|REVERSAL|CHARGEBACK)\b/.test(description);
}

function isInterest(description) {
  return /\bINTEREST EARNED\b/.test(description);
}

function isRevolutAccountTransfer(description) {
  return (revolutAccountPatterns ?? []).some((pattern) => pattern && description.includes(normaliseDescription(pattern)));
}

function isInternalTransfer(transaction, description) {
  return transaction.role === 'internal_transfer'
    || transaction.roleAuto === 'internal_transfer'
    || accountHolderPatterns.some((pattern) => pattern && description.includes(normaliseDescription(pattern)))
    || isRevolutAccountTransfer(description)
    || /\b(?:TOP UP TO PAYLAH|PAYLAH TOP UP|TOP UP WALLET FROM MY ACCOUNT|REVOLUT|OWN ACCOUNT)\b/.test(description);
}

function isClearPersonPayment(description) {
  if (/\b(?:PAYLAH|REVOLUT|OWN ACCOUNT)\b/.test(description) || isRevolutAccountTransfer(description)) return false;
  return /\b(?:PAYNOW|PAY LAH|TRANSFER)\b.*\bTO\b\s+[A-Z][A-Z .-]{2,}/.test(description);
}

function isUnclassifiedTransfer(description) {
  if (isRevolutAccountTransfer(description)) return false;
  return /\b(?:PAYNOW\b.*\bTRANSFER|RECEIVE MONEY FROM|INCOMING PAYNOW REF|DBS I BANK\b.*\bOTHR TRANSFER)\b/.test(description);
}

function defaultCategoryFor(role, outgoing) {
  if (role === 'transfer_to_person') return 'Transfers to People';
  if (role === 'income' || role === 'refund' || role === 'internal_transfer' || role === 'paylah_pending_wallet') return null;
  return outgoing ? 'Uncategorized' : 'Uncategorized';
}

function optional(value) {
  return value === undefined || value === null || String(value).trim() === '' ? null : value;
}
