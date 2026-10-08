import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { runRefresh } from './refresh.mjs';
import { writeWorkbook } from './workbook.mjs';
import { buildBalanceSeries, buildDashboardMetrics, deriveDbsBaseline } from './metrics.mjs';
import { classifyTransactions } from './classify.mjs';
import { reconcileTransactions } from './reconcile.mjs';
import { buildMerchantDirectory } from './merchant-directory.mjs';
import { applyRelationshipScope, buildRelationshipMetrics } from './relationship.mjs';
import { categories, relationshipAccount, categorySubcategories, settings, reloadConfig, dashboardSettings, accountNameFor, closingBalanceFor } from './config.mjs';
import { recipientNumberFor, withRecipientDisplay } from './recipients.mjs';
import { buildProvisionalPaylahRow } from './provisional-paylah.mjs';
import { incomeSourceFor } from './income-sources.mjs';

const root = resolve('.');
const staticRoot = resolve(root, 'frontend/dist');
let report;
let mutations = Promise.resolve();

async function load() {
  reloadConfig();
  report = await runRefresh();
  return report;
}

function payload() {
  const transactions = report.ledger.transactions.map((transaction) => ({
    ...withRecipientDisplay(transaction, report.recipientAliases),
    incomeSource: incomeSourceFor(transaction)
  }));
  const personalTransactions = transactions.filter((transaction) => transaction.accountId !== relationshipAccount.accountId);
  const accountNames = new Map(report.ledger.accountMetadata
    .filter((account) => account.accountName)
    .map((account) => [account.accountId, accountNameFor(account)]));
  const baseline = deriveDbsBaseline({
    transactions: personalTransactions,
    accountMetadata: report.ledger.accountMetadata,
    coverage: report.coverage
  }, report.coverage.latestDate ?? settings.analysis.baseline_date);
  const balanceSeries = buildBalanceSeries({
    transactions: personalTransactions,
    accountMetadata: report.ledger.accountMetadata,
    coverage: report.coverage,
    latestDate: report.coverage.latestDate
  });
  const accountsById = new Map();
  const metadata = [...report.ledger.accountMetadata].sort((a, b) => String(b.statementDate ?? '').localeCompare(String(a.statementDate ?? '')));
  for (const account of metadata) {
    if (accountsById.has(account.accountId)) continue;
    const closingBalance = closingBalanceFor(account);
    const assumed = closingBalance !== null;
    accountsById.set(account.accountId, {
      accountId: account.accountId,
      accountName: accountNames.get(account.accountId) ?? account.accountName ?? account.accountId,
      scope: account.accountId === relationshipAccount.accountId ? 'Shared' : 'Personal',
      balanceSgd: assumed ? closingBalance : account.currentBalance,
      ledgerBalanceSgd: account.ledgerBalance ?? null,
      statementDate: account.statementDate ?? (assumed ? report.coverage.latestDate : null),
      assumed
    });
  }
  const subcategories = Object.fromEntries(categories.map(category => [category, [...new Set([
    ...(categorySubcategories[category] ?? []), ...transactions.filter(row => row.category === category && row.subcategory).map(row => row.subcategory)
  ])]]));
  return {
    settings: dashboardSettings(),
    metrics: buildDashboardMetrics(personalTransactions, {
      baselineBalanceSgd: baseline.balanceSgd,
      baselineDate: baseline.cutoffDate,
      forecastFromDate: report.coverage.latestDate,
      balanceSeries
    }),
    baseline,
    accounts: [...accountsById.values()],
    categories,
    subcategories,
    transactions,
    relationship: buildRelationshipMetrics(transactions, report.ledger.accountMetadata),
    coverage: report.coverage,
    sourceGaps: report.coverage.gaps.map((gap) => ({
      ...gap,
      label: `${accountNames.get(gap.accountId) ?? gap.accountId} (${gap.accountId}): ${gap.startDate} to ${gap.endDate}`
    })),
    lastUpdatedAt: report.generatedAt
  };
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/data' && request.method === 'GET') return json(response, payload());
    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      return await serializeMutation(async () => { await load(); return json(response, payload()); });
    }
    if (url.pathname.startsWith('/api/transactions/') && request.method === 'POST') {
      return await serializeMutation(async () => {
      const id = decodeURIComponent(url.pathname.slice('/api/transactions/'.length));
      const patch = await body(request);
      const transaction = report.ledger.transactions.find((entry) => entry.id === id);
      if (!transaction) return json(response, { error: 'Transaction not found' }, 404);
      if (transaction.source === 'derived-paylah') return json(response, { error: 'This provisional row is derived from bank top-ups and cannot be retagged.' }, 400);
      if (patch.manualCategory && !categories.includes(patch.manualCategory)) return json(response, { error: 'Unknown spending category' }, 400);
      const roles = ['expense', 'income', 'refund', 'peer_receipt', 'internal_transfer', 'transfer_to_person', 'relationship_transfer', 'relationship_contribution', 'paylah_pending_wallet'];
      if (patch.manualRole && !roles.includes(patch.manualRole)) return json(response, { error: 'Unknown transaction role' }, 400);
      for (const key of ['manualCategory', 'manualSubcategory', 'manualRole', 'reviewNote']) if (key in patch) transaction[key] = patch[key] || null;
      const merchantDirectory = new Map(report.merchantDirectory.map((entry) => [entry.merchantKey, entry]));
      const classified = await classifyTransactions(report.ledger.transactions
        .filter((entry) => entry.source !== 'derived-paylah')
        .map((entry) => ({ ...entry, role: entry.roleAuto ?? null })), { directory: merchantDirectory });
      const reconciliation = reconcileTransactions(classified);
      const scopedTransactions = applyRelationshipScope(reconciliation.transactions);
      const provisionalPaylah = buildProvisionalPaylahRow({ transactions: scopedTransactions, coverage: report.coverage });
      report.ledger = { ...report.ledger, transactions: provisionalPaylah ? [...scopedTransactions, provisionalPaylah] : scopedTransactions, reconciliation };
      report.merchantDirectory = buildMerchantDirectory(scopedTransactions, merchantDirectory);
      report.generatedAt = new Date().toISOString();
      await writeWorkbook({ transactions: report.ledger.transactions, accountMetadata: report.ledger.accountMetadata, coverage: report.coverage, merchantDirectory: report.merchantDirectory, recipientAliases: report.recipientAliases, preserveManualOverrides: false });
      return json(response, payload());
      });
    }
    if (url.pathname === '/api/recipient-aliases' && request.method === 'POST') {
      return await serializeMutation(async () => {
      const patch = await body(request);
      const number = String(patch.number ?? '').trim();
      const name = String(patch.name ?? '').trim();
      if (!/^\d{8}$/.test(number) || name.length > 80) return json(response, { error: 'Enter a valid eight-digit number and a name of at most 80 characters.' }, 400);
      if (!report.ledger.transactions.some((transaction) => recipientNumberFor(transaction) === number)) return json(response, { error: 'Recipient number not found in the ledger.' }, 404);
      if (name) report.recipientAliases.set(number, name);
      else report.recipientAliases.delete(number);
      report.generatedAt = new Date().toISOString();
      await writeWorkbook({ transactions: report.ledger.transactions, accountMetadata: report.ledger.accountMetadata, coverage: report.coverage, merchantDirectory: report.merchantDirectory, recipientAliases: report.recipientAliases, preserveManualOverrides: false });
      return json(response, payload());
      });
    }
    const relative = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = resolve(staticRoot, `.${decodeURIComponent(relative)}`);
    if (!file.startsWith(`${staticRoot}/`)) return json(response, { error: 'Not found' }, 404);
    const contents = await readFile(file).catch(error => {
      // The source favicon remains available before the first frontend build.
      if (error.code === 'ENOENT' && relative === '/favicon.svg') return readFile(resolve(root, 'frontend/public/favicon.svg'));
      throw error;
    });
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(contents);
  } catch (error) { json(response, { error: error.code === 'ENOENT' ? 'Not found' : error.message }, error.code === 'ENOENT' ? 404 : 500); }
});

function json(response, value, status = 200) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); }
async function body(request) { let text = ''; for await (const chunk of request) text += chunk; return JSON.parse(text || '{}'); }
async function serializeMutation(action) {
  const pending = mutations.then(action);
  mutations = pending.catch(() => {});
  return pending;
}

if (process.argv[1]?.endsWith('/server.mjs')) {
  await load();
  server.listen(4173, '127.0.0.1', () => console.log('Money dashboard: http://127.0.0.1:4173'));
}
export { server, load, payload };
