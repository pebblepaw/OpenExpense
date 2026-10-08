import settings from '../../../config/demo.json';
import categories from '../../../config/categories.json';
import { categorySubcategories, resolveAutomaticSubcategory } from '../../../src/subcategories.mjs';
import type { ApiData, TransactionPatch } from './finance-data';

export const DEMO_STORAGE_KEY = 'openexpense-synthetic-edits-v1';
type DemoEdits = { transactions: Record<string, TransactionPatch>; aliases: Record<string, string> };
const round = (value: number) => Math.round(value * 100) / 100;
const expenseRoles = new Set(['expense', 'transfer_to_person', 'relationship_transfer', 'paylah_pending_wallet']);

// Created from fictional parameters, never from a bank export or /api/data.
function seedTransactions() {
  let randomSeed = settings.seed;
  const random = () => { randomSeed = (1664525 * randomSeed + 1013904223) >>> 0; return randomSeed / 4294967296; };
  const rows: any[] = [];
  const [savings, spending, revolut, paylah, joint] = settings.accounts;
  function add(account: typeof savings, date: string, name: string, amount: number, role: string, category: string | null = null, extra: Record<string, unknown> = {}) {
    const id = `demo-${String(rows.length + 1).padStart(5, '0')}`;
    const subcategory = resolveAutomaticSubcategory({ category: category ?? '', amountSgd: amount, description: name, role });
    rows.push({ id, fingerprint: id, source: account.source, sourceFile: `fictional-${account.accountName.toLowerCase().replaceAll(' ', '-')}.csv`, accountId: account.accountId,
      transactionDate: date, postedDate: date, descriptionRaw: name, merchantDisplayName: name, amountSgd: round(amount), balanceAfter: null,
      direction: amount > 0 ? 'inflow' : 'outflow', roleAuto: role, role, categoryAuto: category, category,
      subcategoryAuto: subcategory, subcategory, manualCategory: null, manualSubcategory: null, manualRole: null, reviewNote: null, reviewStatus: null, ...extra });
  }
  for (let month = 1; month <= Number(settings.latestDate.slice(5, 7)); month++) {
    const key = `${settings.year}-${String(month).padStart(2, '0')}`;
    const date = (day: number) => `${key}-${String(day).padStart(2, '0')}`;
    const lastDay = key === settings.latestDate.slice(0, 7) ? Number(settings.latestDate.slice(8)) : 28;
    add(savings, date(1), month < 4 ? 'Parent allowance (demo)' : 'Northstar Labs salary (demo)', month < 4 ? settings.allowance : settings.salary, 'income', null, { incomeSource: month < 4 ? 'Allowance' : 'Salary' });
    add(savings, date(2), 'Interest earned (demo)', 3.2 + random() * 4, 'income', null, { incomeSource: 'Interest' });
    if (month % 3 === 0) add(spending, date(5), 'Weekend tutoring (demo)', 180 + month * 12, 'income', null, { incomeSource: 'Tuition' });
    if (month === 2 || month === 7) add(savings, date(8), 'Service allowance (demo)', 110 + month * 5, 'income', null, { incomeSource: 'Service payments' });
    for (const [destination, amount] of [[spending, 800], [revolut, 180], [paylah, 120]] as const) {
      const reconciliationId = `demo-transfer-${month}-${destination.accountId}`;
      add(savings, date(3), `Own transfer to ${destination.accountName} (demo)`, -amount, 'internal_transfer', null, { reconciliationId });
      add(destination, date(3), 'Own-account top-up (demo)', amount, 'internal_transfer', null, { reconciliationId });
    }
    add(spending, date(4), 'Transfer to Relationship Account (demo)', -settings.monthlyJointContribution, 'relationship_transfer', 'Transfer to Relationship Account');
    add(joint, date(4), 'Alex contribution (demo)', settings.monthlyJointContribution, 'relationship_contribution', null, { contributionSource: 'Alex' });
    add(joint, date(4), 'Sam contribution (demo)', settings.partnerJointContribution, 'relationship_contribution', null, { contributionSource: 'Partner / other' });
    for (let day = 1; day <= lastDay; day++) {
      const account = [spending, paylah, revolut][Math.floor(random() * 3)];
      const merchant = settings.merchants[Math.floor(random() * settings.merchants.length)];
      const amount = round(merchant.min + random() * (merchant.max - merchant.min));
      add(account, date(day), merchant.name, -amount, 'expense', merchant.category, { subcategoryAuto: merchant.subcategory, recurring: ['Bills', 'Gym'].includes(merchant.category) });
      if (day % 4 === 0) {
        const meal = settings.merchants[1];
        add(joint, date(day), meal.name, -(22 + random() * 35), 'expense', meal.category);
      }
      if (day % 9 === 0) add(paylah, date(day), 'Meal repayment from Casey (demo)', 8 + random() * 15, 'peer_receipt', 'Unclassified Transfers', { recipientDisplayName: 'Casey (demo)', recipientNumber: '00000001' });
    }
    add(paylah, date(12), 'Transfer to Riley (demo)', -14 - random() * 20, 'transfer_to_person', 'Transfers to People', { recipientDisplayName: 'Riley (demo)', recipientNumber: '00000002' });
  }
  return rows;
}

export function buildDemoData(edits: DemoEdits = { transactions: {}, aliases: {} }): ApiData {
  const transactions = seedTransactions().map(row => {
    const patch = edits.transactions[row.id] ?? {};
    const updated = { ...row, ...patch, role: patch.manualRole ?? row.roleAuto, category: patch.manualCategory ?? row.categoryAuto };
    updated.subcategory = patch.manualSubcategory ?? resolveAutomaticSubcategory({ category: updated.category, amountSgd: updated.amountSgd, role: updated.role, suggestedSubcategory: patch.manualCategory && patch.manualCategory !== row.categoryAuto ? null : row.subcategoryAuto });
    if (row.recipientNumber && edits.aliases[row.recipientNumber]) updated.recipientDisplayName = edits.aliases[row.recipientNumber];
    return updated;
  });
  const joint = settings.accounts.find(account => account.scope === 'Shared')!;
  const monthKeys = [...new Set(transactions.map(row => row.transactionDate.slice(0, 7)))].sort();
  let balance = settings.openingPersonalBalance;
  let jointBalance = 0;
  const balanceSeries: any[] = [];
  const sharedMonths: any[] = [];
  const months = monthKeys.map(month => {
    const personal = transactions.filter(row => row.accountId !== joint.accountId && row.transactionDate.startsWith(month));
    const shared = transactions.filter(row => row.accountId === joint.accountId && row.transactionDate.startsWith(month));
    const netIncomeSgd = round(personal.filter(row => row.role === 'income' && row.amountSgd > 0).reduce((sum, row) => sum + row.amountSgd, 0));
    const outflows = personal.filter(row => expenseRoles.has(row.role) && row.amountSgd < 0);
    const grossSpendSgd = round(outflows.reduce((sum, row) => sum - row.amountSgd, 0));
    const reimbursementsSgd = round(personal.filter(row => ['peer_receipt', 'refund'].includes(row.role) && row.amountSgd > 0).reduce((sum, row) => sum + row.amountSgd, 0));
    const netPersonalSpendSgd = round(grossSpendSgd - reimbursementsSgd);
    const savedSgd = round(netIncomeSgd - netPersonalSpendSgd);
    balance = round(balance + personal.reduce((sum, row) => sum + row.amountSgd, 0));
    balanceSeries.push({ month, balanceSgd: balance, savedSgd, partial: month === settings.latestDate.slice(0, 7), estimated: false, asOfDate: month === settings.latestDate.slice(0, 7) ? settings.latestDate : `${month}-28` });
    const contributions = shared.filter(row => row.role === 'relationship_contribution' && row.amountSgd > 0);
    const sharedExpenses = shared.filter(row => row.role !== 'internal_transfer' && row.amountSgd < 0);
    jointBalance = round(jointBalance + shared.reduce((sum, row) => sum + row.amountSgd, 0));
    const categoryTotals = (rows: any[]) => Object.fromEntries(categories.map(category => [category, round(rows.filter(row => row.category === category).reduce((sum, row) => sum - row.amountSgd, 0))]));
    sharedMonths.push({ month, userFundingSgd: round(contributions.filter(row => row.contributionSource === 'Alex').reduce((sum, row) => sum + row.amountSgd, 0)), partnerFundingSgd: round(contributions.filter(row => row.contributionSource !== 'Alex').reduce((sum, row) => sum + row.amountSgd, 0)), spendSgd: round(sharedExpenses.reduce((sum, row) => sum - row.amountSgd, 0)), categories: categoryTotals(sharedExpenses) });
    return { month, netIncomeSgd, grossSpendSgd, reimbursementsSgd, netPersonalSpendSgd, savedSgd, categories: categoryTotals(outflows) };
  });
  const recent = months.slice(-4, -1);
  const average = (key: 'netIncomeSgd' | 'netPersonalSpendSgd') => recent.reduce((sum, row) => sum + row[key], 0) / recent.length;
  const projectedYearEndBalanceSgd = round(balance + (12 - Number(settings.latestDate.slice(5, 7))) * (average('netIncomeSgd') - average('netPersonalSpendSgd')));
  const accounts = settings.accounts.map(account => ({ ...account, scope: account.scope as 'Personal' | 'Shared', balanceSgd: account.scope === 'Shared' ? jointBalance : account.accountName === 'DBS Savings' ? round(balance * .8) : account.accountName === 'DBS Spending' ? round(balance * .2) : 0, statementDate: settings.latestDate }));
  return {
    metrics: { months, balanceSeries, forecast: [], baselineBalanceSgd: balance, projectedYearEndBalanceSgd },
    baseline: { balanceSgd: balance, accounts: accounts.filter(account => account.scope === 'Personal'), estimated: false },
    accounts, transactions, categories,
    subcategories: categorySubcategories,
    relationship: { accountId: joint.accountId, accountName: joint.accountName, userLabel: 'Alex', partnerLabel: 'Sam', availableBalanceSgd: jointBalance, ledgerBalanceSgd: jointBalance, months: sharedMonths, statementDate: settings.latestDate },
    coverage: { startDate: `${settings.year}-01-01`, latestDate: settings.latestDate, intervals: [], gaps: [] },
    sourceGaps: [], lastUpdatedAt: `${settings.latestDate}T12:00:00Z`
  };
}

function readEdits(): DemoEdits {
  try { return JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) ?? 'null') ?? { transactions: {}, aliases: {} }; }
  catch { return { transactions: {}, aliases: {} }; }
}
export const getDemoData = () => buildDemoData(readEdits());
export function saveDemoTransaction(id: string, patch: TransactionPatch) {
  if (!seedTransactions().some(row => row.id === id)) throw new Error('Unknown demo transaction.');
  const edits = readEdits();
  edits.transactions[id] = { ...edits.transactions[id], ...patch };
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(edits));
  return buildDemoData(edits);
}
export function saveDemoAlias(number: string, name: string) {
  if (!seedTransactions().some(row => row.recipientNumber === number)) throw new Error('Unknown demo recipient.');
  const edits = readEdits(); edits.aliases[number] = name;
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(edits));
  return buildDemoData(edits);
}
export function resetDemoData() { localStorage.removeItem(DEMO_STORAGE_KEY); return buildDemoData(); }
