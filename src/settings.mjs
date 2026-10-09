// Pure configuration helpers shared by the pipeline and synthetic demo.
export function mergeSettings(base, override = {}) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe configuration key');
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeSettings(base[key] ?? {}, value) : structuredClone(value);
  }
  return result;
}

export function validateSettings(config) {
  const fail = message => { throw new Error(`Invalid OpenExpense configuration: ${message}`); };
  const date = (value, field) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) fail(`${field} must be a valid YYYY-MM-DD date`);
  };
  if (config.version !== 1) fail('version must be 1');
  date(config.analysis?.start_date, 'analysis.start_date');
  date(config.analysis?.baseline_date, 'analysis.baseline_date');
  if (config.analysis.end_date) { date(config.analysis.end_date, 'analysis.end_date'); if (config.analysis.end_date < config.analysis.start_date) fail('analysis.end_date precedes start_date'); }
  for (const [field, value] of [['forecast.income_average_start_month',config.forecast?.income_average_start_month],['forecast.target_month',config.forecast?.target_month]]) {
    if (value !== null && value !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) fail(`${field} must be YYYY-MM or null`);
  }
  for (const [field,value] of [['forecast.recent_months',config.forecast?.recent_months],['forecast.slider_step',config.forecast?.slider_step],['forecast.slider_max',config.forecast?.slider_max]]) if (!Number.isFinite(value) || value <= 0) fail(`${field} must be a positive number`);
  if (!Number.isInteger(config.forecast.recent_months)) fail('forecast.recent_months must be an integer');
  if (!Number.isInteger(config.transfer_matching?.max_calendar_days) || config.transfer_matching.max_calendar_days < 0 || !Number.isFinite(config.transfer_matching.amount_tolerance_sgd) || config.transfer_matching.amount_tolerance_sgd < 0) fail('transfer_matching requires nonnegative days and amount tolerance');
  if (!config.app?.name || !config.app.personal_label) fail('app names must not be empty');
  if (!Number.isInteger(config.app.chart?.max_categories) || config.app.chart.max_categories < 1 || !Number.isFinite(config.app.chart.minimum_category_share) || config.app.chart.minimum_category_share < 0 || config.app.chart.minimum_category_share > 1 || !config.app.chart.other_label) fail('app.chart needs a positive category limit, a share between 0 and 1, and an Other label');
  try { new Intl.NumberFormat(config.app.locale); } catch { fail('app.locale is not supported'); }
  for (const field of ['account_holder_patterns','revolut_account_patterns','known_income_patterns']) if (!Array.isArray(config[field]) || config[field].some(value => typeof value !== 'string' || !value.trim())) fail(`${field} must be a list of nonempty strings`);
  for (const [name,patterns] of Object.entries(config.income_sources ?? {})) if (!name || !Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string' || !pattern)) fail(`income_sources.${name} must be a list of patterns`);
  for (const field of ['dbs','paylah','revolut']) if (typeof config.sources?.[field] !== 'string' || !config.sources[field]) fail(`sources.${field} must be a path`);
  if (!config.workbook || !config.merchant_directory) fail('workbook and merchant_directory paths are required');
  for (const id of ['food','groceries','transport','shopping','entertainment','travel','bills','gym','education','healthcare','cash','relationship_transfer','people_transfer','unclassified_transfer','pending_paylah','fees','uncategorized']) if (!config.categories?.[id]) fail(`keep the stable category ID ${id}; its name can be changed`);
  const labels = new Map();
  for (const [id,category] of Object.entries(config.categories)) {
    if (!category.name || typeof category.color !== 'string') fail(`categories.${id} needs a name and color`);
    if (!Array.isArray(category.subcategories) || !Array.isArray(category.aliases)) fail(`categories.${id} needs subcategories and aliases lists`);
    for (const label of [id,category.name,...category.aliases]) {
      if (typeof label !== 'string' || !label.trim()) fail(`categories.${id} has an empty alias`);
      const key = label.toLowerCase();
      if (labels.has(key) && labels.get(key) !== id) fail(`category alias ${label} is ambiguous`);
      labels.set(key,id);
    }
    const bands = category.amount_bands ?? [];
    if (bands.length && (bands.at(-1).min !== 0 || bands.some((band,index) => !Number.isFinite(band.min) || band.min < 0 || !band.name || index > 0 && band.min >= bands[index-1].min))) fail(`categories.${id}.amount_bands must descend to a final min of 0`);
    for (const rule of category.match_rules ?? []) try { new RegExp(rule.pattern,'i'); } catch { fail(`categories.${id} contains an invalid match pattern`); }
  }
  if (!config.categories[config.app.default_category]) fail('app.default_category must be a category ID');
  if (Object.values(config.categories).some(category => category.name === config.app.chart.other_label)) fail('app.chart.other_label must differ from category names');
  for (const rule of config.classification_rules ?? []) {
    if (!config.categories[rule.category]) fail('classification_rules contains an unknown category ID');
    try { new RegExp(rule.pattern,'i'); } catch { fail('classification_rules contains an invalid regex'); }
  }
  const joint = config.relationship_account;
  if (!joint?.account_id || !joint.account_name || !joint.user_label || !joint.partner_label || !Array.isArray(joint.personal_funding_account_ids) || !Array.isArray(joint.partner_funding_account_ids)) fail('relationship_account labels and funding ID lists are required');
  if (joint.start_date) date(joint.start_date,'relationship_account.start_date');
  for (const balance of Object.values(config.assumed_closing_balances ?? {})) if (!Number.isFinite(balance)) fail('assumed_closing_balances values must be numbers');
  for (const [id,account] of Object.entries(config.accounts ?? {})) if (typeof account !== 'object' || typeof account.name !== 'string' || !account.name || account.closing_balance != null && !Number.isFinite(account.closing_balance)) fail(`accounts.${id} needs a name and an optional numeric closing_balance`);
  const demo = config.demo;
  date(demo?.latestDate,'demo.latestDate');
  if (!Number.isInteger(demo.year) || Number(demo.latestDate.slice(0,4)) !== demo.year) fail('demo.year must match demo.latestDate');
  for (const kind of ['savings','spending','paylah','revolut','relationship']) if (demo.accounts.filter(account => account.kind === kind).length !== 1) fail(`demo.accounts must define exactly one ${kind} account`);
  if (demo.accounts.some(account => !account.accountId?.startsWith('DEMO-') || !account.accountName || !Number.isFinite(account.balance_share))) fail('demo accounts need fictional DEMO- IDs, names and balance shares');
  if (Math.abs(demo.accounts.filter(account => account.kind !== 'relationship').reduce((sum,account) => sum + account.balance_share,0)-1)>0.000001) fail('personal demo balance shares must sum to 1');
  for (const merchant of demo.merchants) if (!labels.has(merchant.category.toLowerCase()) || !Number.isFinite(merchant.min) || !Number.isFinite(merchant.max) || merchant.min < 0 || merchant.max < merchant.min) fail('demo merchants need a known category and valid amount range');
  for (const scope of ['personal','shared']) {
    const pattern = demo.spending_patterns?.[scope];
    if (!Number.isInteger(pattern?.every_days) || pattern.every_days < 1 || !Number.isFinite(pattern.amount_scale) || pattern.amount_scale <= 0 || !Number.isInteger(pattern.purchases_per_day?.min) || pattern.purchases_per_day.min < 1 || !Number.isInteger(pattern.purchases_per_day.max) || pattern.purchases_per_day.max < pattern.purchases_per_day.min) fail(`demo.spending_patterns.${scope} needs a positive frequency, amount scale and purchase count range`);
  }
  for (const merchant of demo.merchants) {
    for (const scope of ['personal','shared']) if (merchant[`${scope}_weight`] != null && (!Number.isFinite(merchant[`${scope}_weight`]) || merchant[`${scope}_weight`] < 0)) fail('demo merchant weights must be nonnegative');
    if (merchant.monthly_day != null && (!Number.isInteger(merchant.monthly_day) || merchant.monthly_day < 1 || merchant.monthly_day > 28)) fail('demo monthly_day must be between 1 and 28');
    if (merchant.active_months && (!Array.isArray(merchant.active_months) || merchant.active_months.some(month=>!Number.isInteger(month)||month<1||month>12))) fail('demo active_months must contain month numbers');
  }
  return config;
}

export const categoryNameFrom = (config,id) => config.categories[id].name;
export function canonicalCategoryFrom(config,value) {
  if (!value) return null;
  const key = String(value).toLowerCase();
  const match = Object.entries(config.categories).find(([id,category]) => [id,category.name,...category.aliases].some(label => label.toLowerCase() === key));
  return match ? match[1].name : value;
}
export const subcategoriesFrom = config => Object.fromEntries(Object.values(config.categories).map(category => [category.name,[...new Set([...category.subcategories,...(category.amount_bands ?? []).map(band => band.name),...(category.match_rules ?? []).map(rule => rule.name),category.default_subcategory].filter(Boolean))]]));
// This whitelist is safe to send to the dashboard; identities and paths never enter demo builds.
export const publicSettings = config => structuredClone({ app:config.app,analysis:config.analysis,forecast:config.forecast,categories:config.categories,source_labels:config.source_labels,income_fallback_label:config.income_fallback_label });
