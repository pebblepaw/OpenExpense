import { access, readFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { categories, paths, relationshipAccount, categorySubcategories, categoryName, canonicalCategory } from './config.mjs';
import { buildBalanceSeries, buildDashboardMetrics } from './metrics.mjs';

const manualFields = ['manualCategory', 'manualSubcategory', 'manualRole', 'reviewNote'];
const transactionHeaders = [
  'id', 'fingerprint', 'source', 'sourceFile', 'accountId', 'transactionDate', 'postedDate', 'descriptionRaw',
  'amountSgd', 'balanceAfter', 'direction', 'roleAuto', 'categoryAuto', 'subcategoryAuto', 'role', 'category',
  'manualCategory', 'manualSubcategory', 'manualRole', 'reviewNote', 'reviewStatus', 'reconciliationId', 'sourceLocator', 'subcategory'
];
const roles = ['expense', 'income', 'refund', 'peer_receipt', 'internal_transfer', 'transfer_to_person', 'relationship_transfer', 'relationship_contribution', 'paylah_pending_wallet'];
const merchantHeaders = ['merchantKey', 'displayName', 'category', 'subcategory', 'confidence', 'sourceUrl', 'notes', 'reviewStatus', 'transactionCount', 'totalSpendSgd', 'exampleDescription'];
const metricHeaders = ['month', 'metric', 'category', 'amountSgd', 'previousMonthAmountSgd', 'changeSgd', 'changePct', 'notes'];
const currencyFormat = '"S$"#,##0.00;[Red]("S$"#,##0.00);-';

export async function writeWorkbook({
  transactions = [], coverage = {}, accountMetadata = [], merchantDirectory = [], recipientAliases, monthlyMetrics = [],
  workbookPath = resolve(paths.workbook), preserveManualOverrides = true
} = {}) {
  const destination = resolve(workbookPath);
  const preserved = preserveManualOverrides ? await readWorkbookManualOverrides(destination) : new Map();
  const aliases = recipientAliases === undefined ? await readWorkbookRecipientAliases(destination) : new Map(recipientAliases);
  const rows = transactions.map(row => ({
    ...row,
    ...(preserved.has(row.id) ? Object.fromEntries(manualFields.map(field => [field, preserved.get(row.id)[field] ?? row[field] ?? null])) : {})
  })).sort((a, b) => String(b.transactionDate ?? '').localeCompare(String(a.transactionDate ?? '')) || String(a.id).localeCompare(String(b.id)));
  const personalRows = rows.filter(row => row.accountId !== relationshipAccount.accountId);
  const balanceSeries = buildBalanceSeries({ transactions: personalRows, accountMetadata, coverage, latestDate: coverage.latestDate });
  const metrics = monthlyMetrics.length ? monthlyMetrics : buildDashboardMetrics(personalRows, { balanceSeries }).monthlyMetricsRows;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OpenExpense';

  const ledger = tableSheet(workbook, 'Transactions', 'TransactionsTable', transactionHeaders, rows.map(transactionRow),
    [26,26,14,28,20,13,13,42,14,14,12,20,22,22,20,22,22,24,21,32,16,26,30,30]);
  columnFormats(ledger, [6,7], 'yyyy-mm-dd');
  columnFormats(ledger, [9,10], currencyFormat);
  editable(ledger, [17,18,19,20]);
  reviewHighlight(ledger, 21, 'needs_review');

  const assumptions = tableSheet(workbook, 'Assumptions', null, ['Assumption','Value','Notes'], [
    ['Currency','SGD','All amounts are Singapore dollars.'],
    ['Ledger rows',rows.length,'Rows in Transactions.'],
    ['Coverage start',dateValue(coverage.startDate),'First date checked for source coverage.'],
    ['Coverage latest',dateValue(coverage.latestDate),'Latest imported source date.'],
    ['Manual columns',manualFields.join(', '),'Yellow cells are editable and preserved by stable transaction ID.'],
    ['Review queue','Filter reviewStatus = needs_review','Unresolved classifications and matches.'],
    ['Balance history','DBS/POSB balances; PayLah and Revolut closing balances assumed S$0','Incomplete source coverage is marked as estimated.']
  ], [22,44,66]);
  assumptions.getCell('B4').numFmt = 'yyyy-mm-dd';
  assumptions.getCell('B5').numFmt = 'yyyy-mm-dd';
  assumptions.eachRow(row => row.eachCell(cell => { cell.alignment = { wrapText: true, vertical: 'top' }; }));

  const coverageRows = [
    ...(coverage.intervals ?? []).map(row => ['Source interval',row.accountId,dateValue(row.startDate),dateValue(row.endDate),row.source,displaySourceFile(row.sourceFile),null]),
    ...(coverage.gaps ?? []).map(row => ['Coverage gap',row.accountId,dateValue(row.startDate),dateValue(row.endDate),null,null,'No imported source covers this date range.'])
  ];
  const sourceCoverage = tableSheet(workbook, 'Source Coverage','SourceCoverageTable',['Status','Account ID','Start Date','End Date','Source','Source File','Warning'],coverageRows,[18,24,14,14,16,42,54]);
  columnFormats(sourceCoverage,[3,4],'yyyy-mm-dd');
  reviewHighlight(sourceCoverage,1,'Coverage gap');

  const merchants = tableSheet(workbook,'Merchant Directory','MerchantDirectoryTable',merchantHeaders,
    merchantDirectory.map(row => merchantHeaders.map(key => ['transactionCount','totalSpendSgd'].includes(key) ? numberOrNull(row[key]) : row[key] ?? null)),
    [38,30,23,26,13,48,38,16,17,17,50]);
  editable(merchants,[2,3,4,5,6,7]); columnFormats(merchants,[10],currencyFormat); reviewHighlight(merchants,8,'needs_review');

  const recipients = tableSheet(workbook,'Recipient Directory','RecipientDirectoryTable',['phoneNumber','displayName'],[...aliases].sort(([a],[b]) => a.localeCompare(b)),[22,34]);
  editable(recipients,[2]);
  const monthly = tableSheet(workbook,'Monthly Metrics','MonthlyMetricsTable',metricHeaders,
    metrics.map(row => [dateValue(row.month+'-01'),row.metric,row.category,numberOrNull(row.amountSgd),numberOrNull(row.previousMonthAmountSgd),numberOrNull(row.changeSgd),numberOrNull(row.changePct),row.notes ?? 'Derived from Transactions; refresh rebuilds this sheet.']),
    [16,24,25,18,25,18,14,54]);
  columnFormats(monthly,[1],'mmm yyyy'); columnFormats(monthly,[4,5,6],currencyFormat); columnFormats(monthly,[7],'0.0%;[Red](0.0%);-');
  const joint = tableSheet(workbook,'Relationship Account','RelationshipTransactionsTable',['Date','Description','Amount SGD','Role','Category','Contribution source','Transaction ID'],
    rows.filter(row => row.accountId === relationshipAccount.accountId).map(row => [dateValue(row.transactionDate),row.descriptionRaw,numberOrNull(row.amountSgd),row.role,row.category,row.contributionSource ?? null,row.id]),
    [14,66,18,26,28,22,33]);
  columnFormats(joint,[1],'yyyy-mm-dd'); columnFormats(joint,[3],currencyFormat);

  // Named ranges avoid Excel's 255-character limit for literal validation lists.
  const lists = workbook.addWorksheet('_Validation', { state: 'veryHidden' });
  const subcategories = [...new Set([...Object.values(categorySubcategories).flat(), ...merchantDirectory.map(row => row.subcategory), ...rows.flatMap(row => [row.subcategoryAuto,row.subcategory,row.manualSubcategory])].filter(Boolean))];
  for (const [column, name, values] of [[1,'ExpenseCategories',categories],[2,'ExpenseSubcategories',subcategories],[3,'TransactionRoles',roles]]) {
    values.forEach((value,index) => { lists.getCell(index+1,column).value = value; });
    const letter = String.fromCharCode(64+column);
    workbook.definedNames.add("'_Validation'!$"+letter+"$1:$"+letter+"$"+Math.max(1,values.length),name);
  }
  for (const [sheet,column,name] of [[ledger,17,'ExpenseCategories'],[ledger,18,'ExpenseSubcategories'],[ledger,19,'TransactionRoles'],[merchants,3,'ExpenseCategories']]) {
    for (let row=2; row<=sheet.rowCount; row++) sheet.getCell(row,column).dataValidation = { type:'list',allowBlank:true,formulae:[name] };
  }
  const temporary = destination + '.writing-' + randomUUID();
  await workbook.xlsx.writeFile(temporary);
  await rename(temporary,destination);
  return { workbookPath:destination,transactionCount:rows.length };
}

async function sheetValues(path, name) {
  if (!(await exists(path))) return [];
  const workbook = new ExcelJS.Workbook();
  const input = await readFile(path);
  const archive = await JSZip.loadAsync(input);
  let normalized = false;
  // Older exports used an explicit x: spreadsheet namespace. ExcelJS expects
  // equivalent default namespaces; normalize XML only in memory, not the file.
  for (const entry of Object.values(archive.files).filter(entry => /\.(xml|rels)$/.test(entry.name))) {
    const xml = await entry.async('string');
    let compatible = xml;
    if (xml.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) compatible = xml.replaceAll('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/(<\/?)(?:x:)/g, '$1');
    if (entry.name.startsWith('xl/worksheets/_rels/')) compatible = compatible.replaceAll('Target="/xl/', 'Target="../');
    if (entry.name === 'xl/_rels/workbook.xml.rels') compatible = compatible.replaceAll('Target="/xl/', 'Target="');
    if (compatible !== xml) { archive.file(entry.name, compatible); normalized = true; }
  }
  await workbook.xlsx.load(normalized ? await archive.generateAsync({ type: 'nodebuffer' }) : input);
  const sheet = workbook.getWorksheet(name);
  if (!sheet) return [];
  const values = [];
  for (let row=1; row<=sheet.rowCount; row++) {
    values.push(Array.from({ length:sheet.columnCount },(_,column) => {
      const value=sheet.getCell(row,column+1).value;
      if (value && typeof value==='object' && 'result' in value) return value.result;
      if (value && typeof value==='object' && 'richText' in value) return value.richText.map(part => part.text).join('');
      return value;
    }));
  }
  return values;
}
export async function readWorkbookManualOverrides(path = resolve(paths.workbook)) {
  const [headers=[],...rows] = await sheetValues(path,'Transactions');
  const indexes = new Map(headers.map((header,index) => [String(header),index]));
  if (!indexes.has('id')) return new Map();
  return new Map(rows.filter(row => row[indexes.get('id')]).map(row => [String(row[indexes.get('id')]),Object.fromEntries(manualFields.map(field => [field,field==='manualCategory' ? migrateCategory(emptyToNull(row[indexes.get(field)])) : emptyToNull(row[indexes.get(field)])]))]));
}
export async function readWorkbookMerchantDirectory(path = resolve(paths.workbook)) {
  const [headers=[],...rows] = await sheetValues(path,'Merchant Directory');
  const indexes=new Map(headers.map((header,index) => [String(header),index]));
  if (!indexes.has('merchantKey')) return new Map();
  return new Map(rows.map(row => {
    const merchantKey=emptyToNull(row[indexes.get('merchantKey')]), category=migrateCategory(emptyToNull(row[indexes.get('category')]));
    if (!merchantKey || !category || category===categoryName('uncategorized') || !categories.includes(category)) return null;
    return [merchantKey,{ category,...Object.fromEntries(['displayName','subcategory','confidence','sourceUrl','notes'].map(field => [field,emptyToNull(row[indexes.get(field)])])) }];
  }).filter(Boolean));
}
export async function readWorkbookRecipientAliases(path = resolve(paths.workbook)) {
  const [headers=[],...rows]=await sheetValues(path,'Recipient Directory');
  const numberIndex=headers.indexOf('phoneNumber'),nameIndex=headers.indexOf('displayName');
  if (numberIndex<0 || nameIndex<0) return new Map();
  return new Map(rows.map(row => [String(row[numberIndex] ?? '').trim(),String(row[nameIndex] ?? '').trim()]).filter(([number,name]) => /^\d{8}$/.test(number) && name));
}
function tableSheet(workbook,name,tableName,headers,rows,widths) {
  const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1,showGridLines:false}]});
  const data=rows.length ? rows : [headers.map(() => null)];
  if (tableName) sheet.addTable({name:tableName,ref:'A1',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:headers.map(name => ({name,filterButton:true})),rows:data});
  else sheet.addRows([headers,...data]);
  widths.forEach((width,index) => { sheet.getColumn(index+1).width=width; });
  sheet.getRow(1).height=24;
  sheet.getRow(1).eachCell(cell => { cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF12355B'}};cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={horizontal:'center'}; });
  return sheet;
}
function columnFormats(sheet,columns,format) { for (const column of columns) for (let row=2;row<=sheet.rowCount;row++) sheet.getCell(row,column).numFmt=format; }
function editable(sheet,columns) { for (const column of columns) for (let row=2;row<=sheet.rowCount;row++) { const cell=sheet.getCell(row,column); cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};cell.font={color:{argb:'FF0000FF'}}; } }
function reviewHighlight(sheet,column,text) {
  for (let row=2;row<=sheet.rowCount;row++) if (String(sheet.getCell(row,column).value ?? '').includes(text)) { const cell=sheet.getCell(row,column);cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFCE4D6'}};cell.font={bold:true,color:{argb:'FF9C0006'}}; }
}
function transactionRow(row) {
  return transactionHeaders.map(key => ['transactionDate','postedDate'].includes(key) ? dateValue(row[key]) : ['amountSgd','balanceAfter'].includes(key) ? numberOrNull(row[key]) : key==='sourceFile' ? displaySourceFile(row[key]) : key==='sourceLocator' ? row[key] ? JSON.stringify(row[key]) : null : row[key] ?? null);
}
const dateValue=value => value ? new Date(String(value).slice(0,10)+'T00:00:00Z') : null;
const numberOrNull=value => value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value)) ? Number(value) : null;
const displaySourceFile=value => value ? basename(String(value)) : null;
const emptyToNull=value => value===undefined || value===null || String(value).trim()==='' ? null : String(value);
const migrateCategory=canonicalCategory;
async function exists(path) { try { await access(path);return true; } catch { return false; } }
