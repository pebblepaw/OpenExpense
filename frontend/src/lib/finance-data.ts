import { getDemoData, resetDemoData, saveDemoAlias, saveDemoTransaction } from './demo-data';
import defaults from '../../../config/defaults.yaml';
import { publicSettings } from '../../../src/settings.mjs';

// Fixed by Vite at build time: the local app cannot switch to demo, and Pages cannot switch to live.
export const DEMO_ONLY = __OPENEXPENSE_DEMO__;
export const isDemoMode = () => DEMO_ONLY;

export type AccountScope = 'Personal' | 'Shared';
export type Category = string;
export type Period = 'Month' | 'Quarter' | 'Year';
export type TransactionType = 'Income' | 'Expense' | 'Receipt' | 'Internal transfer' | 'Contribution';
export type Transaction = {
  id: string; date: string; merchant: string; detail: string; account: string; accountId: string;
  scope: AccountScope; category: string; subcategory: string | null; amount: number; type: TransactionType;
  role: string; source: string; sourceFile: string; provisional: boolean; recurring: boolean;
  recipientNumber?: string; recipientDisplayName?: string | null;
  incomeSource?: string | null; contributionSource?: string | null;
  manualCategory: string | null; manualSubcategory: string | null; manualRole: string | null;
  reviewNote: string | null; reviewStatus?: string | null;
};
export type TransactionPatch = Partial<Pick<Transaction, 'manualCategory' | 'manualSubcategory' | 'manualRole' | 'reviewNote'>>;
export type Monthly = {
  month: string; label: string; income: number; spending: number; savings: number;
  grossSpend: number; receipts: number; categories: Record<string, number>; balance: number | null;
  partial: boolean; estimated: boolean; userFunding: number; partnerFunding: number;
};
export type CategoryInfo = { name: string; color: string; value: number; previous: number };
export type ApiData = {
  settings: DashboardSettings;
  metrics: { months: any[]; balanceSeries: any[]; forecast: any[]; projectedYearEndBalanceSgd: number; baselineBalanceSgd: number };
  transactions: any[]; baseline: { balanceSgd: number; accounts: any[]; estimated: boolean };
  relationship: { accountId: string; accountName: string; userLabel: string; partnerLabel: string; availableBalanceSgd: number | null; ledgerBalanceSgd: number | null; months: any[]; statementDate: string | null };
  coverage: { startDate: string; latestDate: string; intervals: any[]; gaps: any[] };
  sourceGaps: { label: string; accountId: string; startDate: string; endDate: string }[];
  accounts: { accountId: string; accountName: string; scope: AccountScope; balanceSgd: number | null; ledgerBalanceSgd?: number | null; statementDate?: string | null; assumed?: boolean }[];
  categories: string[]; subcategories: Record<string, string[]>; lastUpdatedAt: string;
};
export type FinanceModel = { data: ApiData; transactions: Transaction[]; personal: Monthly[]; shared: Monthly[]; monthKeys: string[]; categories: CategoryInfo[] };

export type DashboardSettings = {
  app: { name: string; personal_label: string; locale: string; default_category: string; chart: { max_categories: number; minimum_category_share: number; other_label: string } };
  analysis: { start_date: string; end_date: string | null; baseline_date: string };
  forecast: { income_average_start_month: string | null; recent_months: number; target_month: string | null; slider_step: number; slider_max: number };
  categories: Record<string, { name: string; color: string }>;
  source_labels: Record<string, string>; income_fallback_label: string;
};
let displaySettings: DashboardSettings = publicSettings(defaults);
export const currentDisplaySettings = () => displaySettings;

const expenseRoles = new Set(['expense', 'transfer_to_person', 'paylah_pending_wallet', 'relationship_transfer']);
export const money = (value: number, decimals = 0) => new Intl.NumberFormat(displaySettings.app.locale, { style: 'currency', currency: 'SGD', maximumFractionDigits: decimals }).format(value);
export const monthLabel = (key: string, full = false) => new Intl.DateTimeFormat(displaySettings.app.locale, { month: full ? 'long' : 'short', ...(full ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }).format(new Date(`${key}-01T00:00:00Z`));
export const dateLabel = (date: string) => new Intl.DateTimeFormat(displaySettings.app.locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export function adaptFinanceData(data: ApiData): FinanceModel {
  displaySettings = data.settings;
  const names = new Map((data.accounts ?? data.baseline.accounts ?? []).map(account => [account.accountId, account.accountName]));
  names.set(data.relationship.accountId, data.relationship.accountName);
  const transactions = data.transactions.map(row => {
    const type: TransactionType = row.role === 'income' ? 'Income' : row.role === 'internal_transfer' ? 'Internal transfer' : row.role === 'relationship_contribution' ? 'Contribution' : ['refund', 'peer_receipt'].includes(row.role) ? 'Receipt' : 'Expense';
    let merchant = row.recipientDisplayName || row.merchantDisplayName || '';
    if (!merchant) {
      const key = String(row.merchantKey ?? '').replace(/^PAYNOW\s+/i, '').replace(/\b[A-Z0-9-]*\d[A-Z0-9-]{7,}\b/g, '').trim();
      merchant = key ? key.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()) : String(row.descriptionRaw ?? '').replace(/^Debit Card Transaction\s*—\s*/i, '').replace(/\s+—\s+Point-of-Sale Transaction.*$/i, '');
    }
    if (row.recipientNumber && !row.recipientDisplayName) merchant = `Transfer ${row.amountSgd < 0 ? 'to' : 'from'} ${row.recipientNumber}`;
    if (row.role === 'relationship_contribution') merchant = `${row.contributionSource ?? 'Other'} contribution`;
    const account = names.get(row.accountId) || data.settings.source_labels[row.source] || row.accountId;
    return { ...row, date: row.transactionDate, merchant, detail: row.descriptionRaw, account, scope: row.accountId === data.relationship.accountId ? 'Shared' : 'Personal', category: row.category || (type === 'Income' ? 'Income' : type === 'Internal transfer' ? 'Internal transfer' : type === 'Contribution' ? 'Contribution' : data.settings.categories.uncategorized.name), subcategory: row.subcategory ?? row.manualSubcategory ?? row.subcategoryAuto ?? null, amount: Number(row.amountSgd ?? 0), type, provisional: row.source === 'derived-paylah', recurring: Boolean(row.recurring), manualCategory: row.manualCategory ?? null, manualSubcategory: row.manualSubcategory ?? null, manualRole: row.manualRole ?? null, reviewNote: row.reviewNote ?? null } as Transaction;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const monthKeys = [...new Set([...data.metrics.months.map(row => row.month), ...data.metrics.balanceSeries.map(row => row.month), ...data.relationship.months.map(row => row.month)])].sort();
  const personal = monthKeys.map(month => {
    const metrics = data.metrics.months.find(row => row.month === month);
    const balance = data.metrics.balanceSeries.find(row => row.month === month);
    return { month, label: monthLabel(month), income: metrics?.netIncomeSgd ?? 0, spending: metrics?.netPersonalSpendSgd ?? 0, savings: metrics?.savedSgd ?? 0, grossSpend: metrics?.grossSpendSgd ?? 0, receipts: metrics?.reimbursementsSgd ?? 0, categories: metrics?.categories ?? {}, balance: balance?.balanceSgd ?? null, partial: balance?.partial ?? month === data.coverage.latestDate?.slice(0, 7), estimated: Boolean(balance?.estimated), userFunding: 0, partnerFunding: 0 };
  });
  const shared = monthKeys.map(month => {
    const metrics = data.relationship.months.find(row => row.month === month);
    const userFunding = metrics?.userFundingSgd ?? 0, partnerFunding = metrics?.partnerFundingSgd ?? 0;
    return { month, label: monthLabel(month), income: userFunding + partnerFunding, spending: metrics?.spendSgd ?? 0, savings: userFunding + partnerFunding - (metrics?.spendSgd ?? 0), grossSpend: metrics?.spendSgd ?? 0, receipts: 0, categories: metrics?.categories ?? {}, balance: month === data.coverage.latestDate?.slice(0, 7) ? data.relationship.availableBalanceSgd : null, partial: month === data.coverage.latestDate?.slice(0, 7), estimated: false, userFunding, partnerFunding };
  });
  const categoryNames = data.categories ?? [...new Set(transactions.filter(row => row.type === 'Expense').map(row => row.category))];
  return { data, transactions, personal, shared, monthKeys, categories: categoryNames.map(name => ({ name, color: Object.values(data.settings.categories).find(category => category.name === name)?.color ?? 'var(--chart-muted)', value: 0, previous: 0 })) };
}

export function periodKeys(month: string, period: Period, keys: string[]) {
  if (period === 'Month') return [month];
  if (period === 'Year') return keys.filter(key => key.slice(0, 4) === month.slice(0, 4) && key <= month);
  const quarter = Math.floor((Number(month.slice(5)) - 1) / 3);
  return keys.filter(key => key.slice(0, 4) === month.slice(0, 4) && Math.floor((Number(key.slice(5)) - 1) / 3) === quarter);
}
export function previousPeriodKeys(month: string, period: Period, keys: string[]) {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (period === 'Year') return [];
  date.setUTCMonth(date.getUTCMonth() - (period === 'Quarter' ? 3 : 1));
  return periodKeys(date.toISOString().slice(0, 7), period, keys).filter(key => keys.includes(key));
}
export function totalPeriod(series: Monthly[], keys: string[]) {
  return series.filter(row => keys.includes(row.month)).reduce((sum, row) => ({ income: sum.income + row.income, spending: sum.spending + row.spending, savings: sum.savings + row.savings, grossSpend: sum.grossSpend + row.grossSpend, receipts: sum.receipts + row.receipts, userFunding: sum.userFunding + row.userFunding, partnerFunding: sum.partnerFunding + row.partnerFunding }), { income: 0, spending: 0, savings: 0, grossSpend: 0, receipts: 0, userFunding: 0, partnerFunding: 0 });
}
export const changePercent = (current: number, previous: number) => previous === 0 ? null : Math.round((current - previous) / Math.abs(previous) * 100);
export function expenseRows(rows: Transaction[], scope: AccountScope, keys?: string[]) {
  return rows.filter(row => row.scope === scope && expenseRoles.has(row.role) && row.amount < 0 && (!keys || keys.includes(row.date.slice(0, 7))));
}
export function categoryBreakdown(model: FinanceModel, scope: AccountScope, keys: string[], priorKeys: string[] = []) {
  const series = scope === 'Personal' ? model.personal : model.shared;
  return model.categories.map(category => ({ ...category, value: series.filter(row => keys.includes(row.month)).reduce((sum, row) => sum + (row.categories[category.name] ?? 0), 0), previous: series.filter(row => priorKeys.includes(row.month)).reduce((sum, row) => sum + (row.categories[category.name] ?? 0), 0) })).filter(category => category.value !== 0 || category.previous !== 0).sort((a, b) => b.value - a.value);
}
export function subcategoryBreakdown(rows: Transaction[]) {
  const groups = new Map<string, number>();
  for (const row of rows) { const key = row.subcategory || 'Other'; groups.set(key, (groups.get(key) ?? 0) + Math.abs(row.amount)); }
  return [...groups].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

export function incomeRows(rows: Transaction[], scope: AccountScope, keys?: string[]) {
  const role = scope === 'Personal' ? 'income' : 'relationship_contribution';
  return rows.filter(row => row.scope === scope && row.role === role && row.amount > 0 && (!keys || keys.includes(row.date.slice(0, 7))));
}
export const incomeSource = (row: Transaction) => row.scope === 'Shared' ? `${row.contributionSource ?? 'Other'} contributions` : row.incomeSource ?? displaySettings.income_fallback_label;
export function incomeBreakdown(model: FinanceModel, scope: AccountScope, keys: string[], priorKeys: string[] = []) {
  const rows = incomeRows(model.transactions, scope);
  const names = [...new Set(rows.map(incomeSource))].sort();
  const colors = Object.values(model.data.settings.categories).map(category => category.color);
  return names.map((name, index) => ({
    name, color: colors[index % colors.length],
    value: rows.filter(row => incomeSource(row) === name && keys.includes(row.date.slice(0, 7))).reduce((sum, row) => sum + row.amount, 0),
    previous: rows.filter(row => incomeSource(row) === name && priorKeys.includes(row.date.slice(0, 7))).reduce((sum, row) => sum + row.amount, 0)
  })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
export async function loadFinanceData(): Promise<ApiData> { return DEMO_ONLY ? getDemoData() : request('/api/data'); }
export async function refreshFinanceData(): Promise<ApiData> { return DEMO_ONLY ? resetDemoData() : request('/api/refresh', { method: 'POST' }); }
export async function saveTransaction(id: string, patch: TransactionPatch): Promise<ApiData> { return DEMO_ONLY ? saveDemoTransaction(id, patch) : request(`/api/transactions/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(patch) }); }
export async function saveRecipientAlias(number: string, name: string): Promise<ApiData> { return DEMO_ONLY ? saveDemoAlias(number, name) : request('/api/recipient-aliases', { method: 'POST', body: JSON.stringify({ number, name }) }); }
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
