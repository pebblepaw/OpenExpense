import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { parseCsv, normaliseHeader } from './csv.mjs';

const execFileAsync = promisify(execFile);
const manualFields = ['manualCategory', 'manualSubcategory', 'manualRole', 'reviewNote'];

export function parseAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim();
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const numeric = Number(text.replace(/[(),\s]/g, '').replace(/S\$/gi, '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return negative ? -Math.abs(numeric) : numeric;
}

export function toIsoDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  const timestamp = text.match(/^(\d{4}-\d{1,2}-\d{1,2})(?:[ T].*)$/);
  if (timestamp) return toIsoDate(timestamp[1]);
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (named) {
    const month = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
      nov: 11, november: 11, dec: 12, december: 12
    }[named[2].toLowerCase()];
    if (month) return `${named[3]}-${String(month).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
  }
  return null;
}

export function dateWithStatementYear(value, statementDate) {
  const complete = toIsoDate(value);
  if (complete) return complete;
  const partial = String(value ?? '').trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/);
  if (!partial || !statementDate) return null;
  const year = statementDate.slice(0, 4);
  let date = toIsoDate(`${partial[1]} ${partial[2]} ${year}`);
  if (date && date > statementDate) date = `${Number(year) - 1}-${date.slice(5)}`;
  return date;
}

export function normaliseDescription(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/["']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

export function canonicalCounterparty(value = '') {
  const normalised = normaliseDescription(value);
  const canonical = normalised
    .replace(/\b(?:BAT|TRF|ICT)\b/g, ' ')
    .replace(/\b(?:DEBIT CARD TRANSACTION|POINT OF SALE TRANSACTION|ADVICE FUNDS TRANSFER|ADVICE FAST PAYMENT RECEIPT|PAYNOW TRANSFER|ADVICE)\b/g, ' ')
    .replace(/\b(?:FT|MB|IB)\d+\b/g, ' ')
    .replace(/\b\d{4}\s+\d{4}\s+\d{4}\s+\d{4}\b/g, ' ')
    .replace(/\b\d{8,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return canonical || normalised;
}

export function fingerprintFor({ accountId, transactionDate, postedDate, descriptionRaw, amountSgd }) {
  const material = [
    String(accountId ?? '').replace(/\s+/g, ''),
    transactionDate ?? postedDate ?? '',
    canonicalCounterparty(descriptionRaw),
    amountSgd === null || amountSgd === undefined ? '' : Number(amountSgd).toFixed(2)
  ].join('|');
  return `txn_${createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}

export function normalisedTransaction(fields) {
  const amountSgd = fields.amountSgd === null || fields.amountSgd === undefined
    ? null
    : Number(fields.amountSgd);
  const fingerprint = fingerprintFor({ ...fields, amountSgd });
  return {
    id: fingerprint,
    fingerprint,
    source: fields.source,
    sourceFile: fields.sourceFile,
    accountId: fields.accountId,
    transactionDate: fields.transactionDate ?? fields.postedDate ?? null,
    postedDate: fields.postedDate ?? fields.transactionDate ?? null,
    descriptionRaw: fields.descriptionRaw?.trim() ?? '',
    amountSgd,
    balanceAfter: fields.balanceAfter ?? null,
    direction: amountSgd === null ? 'unknown' : amountSgd < 0 ? 'outflow' : 'inflow',
    roleAuto: null,
    categoryAuto: null,
    manualCategory: null,
    manualSubcategory: null,
    manualRole: null,
    reviewNote: null,
    sourceLocator: fields.sourceLocator
  };
}

const sourcePriority = {
  'dbs-csv': 30,
  'dbs-pdf': 20,
  'paylah-pdf': 10,
  'revolut-csv': 10
};

export function buildLedger(imports, { overrides = new Map() } = {}) {
  const mergedOverrides = overrides instanceof Map ? new Map(overrides) : new Map(Object.entries(overrides));
  // Identical merchant/date/amount rows can be separate card purchases. Number
  // occurrences within each export, then reconcile the same ordinal in overlap.
  const candidates = imports.flatMap((result) => {
    const occurrences = new Map();
    return (result.transactions ?? []).map((transaction) => {
      const occurrenceKey = `${transaction.source}|${transaction.sourceFile}|${transaction.fingerprint}`;
      const count = (occurrences.get(occurrenceKey) ?? 0) + 1;
      occurrences.set(occurrenceKey, count);
      return count === 1 ? transaction : {
        ...transaction,
        id: `${transaction.fingerprint}:${count}`,
        fingerprint: `${transaction.fingerprint}:${count}`
      };
    });
  });
  const selected = new Map();
  const duplicates = [];

  for (const transaction of candidates) {
    const existing = selected.get(transaction.fingerprint);
    if (!existing) {
      selected.set(transaction.fingerprint, transaction);
      continue;
    }
    const currentPriority = sourcePriority[transaction.source] ?? 0;
    const existingPriority = sourcePriority[existing.source] ?? 0;
    if (currentPriority > existingPriority) {
      duplicates.push({ fingerprint: transaction.fingerprint, kept: transaction, discarded: existing, reason: 'fingerprint' });
      selected.set(transaction.fingerprint, transaction);
    } else {
      duplicates.push({ fingerprint: transaction.fingerprint, kept: existing, discarded: transaction, reason: 'fingerprint' });
    }
  }
  applySecondaryDbsDeduplication(selected, duplicates);
  applySecondaryRevolutDeduplication(selected, duplicates, mergedOverrides);
  markAmbiguousDbsDuplicates(selected);

  return {
    transactions: [...selected.values()].map((transaction) => applyManualOverrides(transaction, mergedOverrides)).sort(compareTransactions),
    duplicates,
    accountMetadata: imports.flatMap((result) => result.accountMetadata ?? []),
    balanceSnapshots: imports.flatMap((result) => result.balanceSnapshots ?? [])
  };
}

function applySecondaryRevolutDeduplication(selected, duplicates, overrides) {
  const byStableKey = new Map();
  for (const transaction of selected.values()) {
    if (transaction.source !== 'revolut-csv' || transaction.amountSgd === null || transaction.balanceAfter === null) continue;
    const { startedAt, completedAt, transactionType } = transaction.sourceLocator ?? {};
    if (!startedAt || !completedAt) continue;
    const key = [transaction.accountId, startedAt, completedAt, transactionType ?? '', Number(transaction.amountSgd).toFixed(2), Number(transaction.balanceAfter).toFixed(2)].join('|');
    const group = byStableKey.get(key) ?? [];
    group.push(transaction);
    byStableKey.set(key, group);
  }

  for (const group of byStableKey.values()) {
    const byFile = new Map();
    for (const transaction of group) {
      const rows = byFile.get(transaction.sourceFile) ?? [];
      rows.push(transaction);
      byFile.set(transaction.sourceFile, rows);
    }
    if (byFile.size < 2) continue;
    const files = [...byFile].sort(([leftFile, leftRows], [rightFile, rightRows]) =>
      rightRows.length - leftRows.length || revolutFileRank(rightFile).localeCompare(revolutFileRank(leftFile)));
    const keepers = files[0][1].sort((left, right) => Number(left.sourceLocator?.row ?? 0) - Number(right.sourceLocator?.row ?? 0));
    for (const [, rows] of files.slice(1)) {
      rows.sort((left, right) => Number(left.sourceLocator?.row ?? 0) - Number(right.sourceLocator?.row ?? 0));
      rows.forEach((discarded, index) => {
        const kept = keepers[index];
        if (!kept) return; // An extra occurrence may be a separate purchase.
        selected.delete(discarded.fingerprint);
        if (!overrides.has(kept.id) && overrides.has(discarded.id)) overrides.set(kept.id, overrides.get(discarded.id));
        duplicates.push({ fingerprint: discarded.fingerprint, kept, discarded, reason: 'secondary_revolut_key' });
      });
    }
  }
}

function revolutFileRank(sourceFile) {
  const match = String(sourceFile ?? '').match(/account-statement_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/);
  return match ? `${match[2]}|${match[1]}` : String(sourceFile ?? '');
}

function markAmbiguousDbsDuplicates(selected) {
  const bySecondaryKey = new Map();
  for (const transaction of selected.values()) {
    if (!['dbs-csv', 'dbs-pdf'].includes(transaction.source) || transaction.amountSgd === null) continue;
    const key = [transaction.accountId, transaction.transactionDate ?? transaction.postedDate, Number(transaction.amountSgd).toFixed(2)].join('|');
    const group = bySecondaryKey.get(key) ?? [];
    group.push(transaction);
    bySecondaryKey.set(key, group);
  }
  for (const group of bySecondaryKey.values()) {
    if (group.length !== 2) continue;
    const csv = group.find((transaction) => transaction.source === 'dbs-csv');
    const pdf = group.find((transaction) => transaction.source === 'dbs-pdf');
    if (!csv || !pdf || isConservativeSecondaryDbsMatch(csv, pdf)) continue;
    for (const transaction of group) {
      selected.set(transaction.fingerprint, {
        ...transaction,
        reviewStatus: 'needs_review',
        reviewNote: transaction.reviewNote ?? 'ambiguous CSV/PDF duplicate'
      });
    }
  }
}

function applySecondaryDbsDeduplication(selected, duplicates) {
  const bySecondaryKey = new Map();
  for (const transaction of selected.values()) {
    if (!['dbs-csv', 'dbs-pdf'].includes(transaction.source) || transaction.amountSgd === null) continue;
    const key = [transaction.accountId, transaction.transactionDate ?? transaction.postedDate, Number(transaction.amountSgd).toFixed(2)].join('|');
    const group = bySecondaryKey.get(key) ?? [];
    group.push(transaction);
    bySecondaryKey.set(key, group);
  }
  for (const group of bySecondaryKey.values()) {
    if (group.length !== 2) continue;
    const csv = group.find((transaction) => transaction.source === 'dbs-csv');
    const pdf = group.find((transaction) => transaction.source === 'dbs-pdf');
    if (!csv || !pdf || !isConservativeSecondaryDbsMatch(csv, pdf)) continue;
    selected.delete(pdf.fingerprint);
    duplicates.push({ fingerprint: pdf.fingerprint, kept: csv, discarded: pdf, reason: 'secondary_dbs_key' });
  }
}

function isConservativeSecondaryDbsMatch(left, right) {
  return isGenericDbsDescription(left.descriptionRaw)
    || isGenericDbsDescription(right.descriptionRaw)
    || sharesBankReference(left, right);
}

function isGenericDbsDescription(descriptionRaw) {
  const description = normaliseDescription(descriptionRaw);
  return description === ''
    || /\b(?:ADVICE FUNDS TRANSFER|ADVICE FAST PAYMENT RECEIPT|PAYNOW TRANSFER|INTEREST EARNED)\b/.test(description);
}

function sharesBankReference(left, right) {
  const leftReferences = bankReferences(left);
  return [...bankReferences(right)].some((reference) => leftReferences.has(reference));
}

function bankReferences(transaction) {
  const values = [transaction.descriptionRaw, transaction.sourceLocator?.reference].filter(Boolean);
  return new Set(values.flatMap((value) => [...String(value).toUpperCase().matchAll(/\b(?:FT|TF|IPS|MT)[A-Z0-9]{6,}\b|\b\d{8,}\b/g)].map((match) => match[0])));
}

function applyManualOverrides(transaction, overrides) {
  const override = overrides instanceof Map ? overrides.get(transaction.id) : overrides[transaction.id];
  if (!override) return transaction;
  const next = { ...transaction };
  for (const field of manualFields) {
    if (Object.hasOwn(override, field)) next[field] = override[field];
  }
  return next;
}

function compareTransactions(left, right) {
  return (left.transactionDate ?? '').localeCompare(right.transactionDate ?? '')
    || left.sourceFile.localeCompare(right.sourceFile)
    || JSON.stringify(left.sourceLocator).localeCompare(JSON.stringify(right.sourceLocator));
}

export function describeCoverage(transactions) {
  const bySource = new Map();
  for (const transaction of transactions) {
    if (!transaction.transactionDate) continue;
    const dates = bySource.get(transaction.source) ?? [];
    dates.push(transaction.transactionDate);
    bySource.set(transaction.source, dates);
  }
  return [...bySource.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, dates]) => `${source}: ${dates.sort()[0]} to ${dates.sort().at(-1)}`);
}

export function detectCoverageGaps(intervals, { startDate = '2026-01-01', latestDate } = {}) {
  const byAccount = new Map();
  for (const interval of intervals) {
    if (!interval.startDate || !interval.endDate) continue;
    const accountIntervals = byAccount.get(interval.accountId) ?? [];
    accountIntervals.push(interval);
    byAccount.set(interval.accountId, accountIntervals);
  }
  const gaps = [];
  for (const [accountId, accountIntervals] of [...byAccount.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const end = latestDate ?? accountIntervals.reduce((latest, interval) => interval.endDate > latest ? interval.endDate : latest, startDate);
    const merged = mergeIntervals(accountIntervals, startDate, end);
    let cursor = startDate;
    for (const interval of merged) {
      if (cursor < interval.startDate) gaps.push({ accountId, startDate: cursor, endDate: previousDay(interval.startDate) });
      cursor = nextDay(interval.endDate);
    }
    if (cursor <= end) gaps.push({ accountId, startDate: cursor, endDate: end });
  }
  return gaps;
}

function mergeIntervals(intervals, startDate, endDate) {
  const ordered = intervals
    .map((interval) => ({ startDate: interval.startDate < startDate ? startDate : interval.startDate, endDate: interval.endDate > endDate ? endDate : interval.endDate }))
    .filter((interval) => interval.startDate <= interval.endDate)
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  const merged = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (previous && interval.startDate <= nextDay(previous.endDate)) {
      if (interval.endDate > previous.endDate) previous.endDate = interval.endDate;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function nextDay(date) {
  return shiftDate(date, 1);
}

function previousDay(date) {
  return shiftDate(date, -1);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function loadManualOverrides({ workbookPath, overridePath } = {}) {
  for (const path of [overridePath, workbookPath]) {
    if (!path || !(await pathExists(path))) continue;
    const records = await readOverrideRecords(path);
    if (records.length > 0) return new Map(records.filter((record) => record.id).map((record) => [record.id, record]));
  }
  return new Map();
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readOverrideRecords(path) {
  const extension = extname(String(path)).toLowerCase();
  if (extension === '.json') {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return normaliseOverrideRecords(Array.isArray(parsed) ? parsed : parsed.transactions ?? []);
  }
  if (extension === '.csv') return normaliseOverrideRecords(rowsToRecords(parseCsv(await readFile(path, 'utf8'))));
  if (extension === '.xlsx') return normaliseOverrideRecords(await readXlsxRecords(path));
  return [];
}

function rowsToRecords(rows) {
  const [headers = [], ...dataRows] = rows;
  return dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function normaliseOverrideRecords(records) {
  return records.map((record) => {
    const values = Object.fromEntries(Object.entries(record).map(([key, value]) => [normaliseHeader(key).replace(/ /g, ''), value]));
    return {
      id: values.id,
      manualCategory: values.manualcategory ?? values.categorymanual ?? null,
      manualSubcategory: values.manualsubcategory ?? values.subcategorymanual ?? null,
      manualRole: values.manualrole ?? values.rolemanual ?? null,
      reviewNote: values.reviewnote ?? values.note ?? null
    };
  });
}

async function readXlsxRecords(path) {
  const { stdout: listing } = await execFileAsync('unzip', ['-Z1', path]);
  const entries = listing.split(/\r?\n/).filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/.test(entry));
  const sharedStrings = listing.includes('xl/sharedStrings.xml') ? parseSharedStrings(await unzipEntry(path, 'xl/sharedStrings.xml')) : [];
  for (const entry of entries) {
    const rows = parseXlsxRows(await unzipEntry(path, entry), sharedStrings);
    const records = rowsToRecords(rows);
    if (records.some((record) => normaliseHeader(Object.keys(record)[0] ?? '') === 'id')) return records;
  }
  return [];
}

async function unzipEntry(path, entry) {
  const { stdout } = await execFileAsync('unzip', ['-p', path, entry]);
  return stdout;
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => decodeXml(match[1].replace(/<[^>]+>/g, '')));
}

function parseXlsxRows(xml, sharedStrings) {
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cellMatch[1].match(/\br="([A-Z]+)\d+"/)?.[1];
      const column = reference ? columnIndex(reference) : cells.length;
      const type = cellMatch[1].match(/\bt="([^"]+)"/)?.[1];
      const raw = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? cellMatch[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
      cells[column] = type === 's' ? sharedStrings[Number(raw)] ?? '' : decodeXml(raw);
    }
    return cells;
  });
}

function columnIndex(reference) {
  return [...reference].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value) {
  return String(value).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}
