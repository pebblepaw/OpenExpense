import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { mergeSettings, validateSettings, canonicalCategoryFrom, categoryNameFrom, subcategoriesFrom, publicSettings } from './settings.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configDir = resolve(rootDir, 'config');
const defaultsPath = resolve(configDir, 'defaults.yaml');

export let settings, paths, categories, categorySubcategories, relationshipAccount, knownIncomePatterns, incomeSourceRules, accountHolderPatterns, revolutAccountPatterns, transferMatching;
export const categoryName = id => categoryNameFrom(settings,id);
export const canonicalCategory = value => canonicalCategoryFrom(settings,value);
export const dashboardSettings = () => publicSettings(settings);
export const accountNameFor = account => account.accountId === relationshipAccount.accountId
  ? relationshipAccount.accountName : settings.accounts[account.accountId]?.name ?? account.accountName ?? settings.source_labels[account.source] ?? account.accountId;
export const closingBalanceFor = account => settings.accounts[account.accountId]?.closing_balance ?? settings.assumed_closing_balances[account.source] ?? null;

export function reloadConfig() {
  if (typeof process.loadEnvFile === 'function' && existsSync(resolve(rootDir,'.env'))) process.loadEnvFile(resolve(rootDir,'.env'));
  const candidates = [process.env.OPENEXPENSE_CONFIG,resolve(configDir,'config.yaml'),resolve(configDir,'config.yml'),resolve(rootDir,'config.yaml'),resolve(rootDir,'config.yml')].filter(Boolean);
  const file = process.env.OPENEXPENSE_CONFIG ?? candidates.find(existsSync);
  if (process.env.OPENEXPENSE_CONFIG && !existsSync(file)) throw new Error('OPENEXPENSE_CONFIG does not exist');
  const defaults = parse(readFileSync(defaultsPath,'utf8'));
  const overrides = file ? parse(readFileSync(file,'utf8')) : {};
  if (overrides !== null && (typeof overrides !== 'object' || Array.isArray(overrides))) throw new Error('OpenExpense YAML must contain a settings mapping');
  const merged = mergeSettings(defaults,overrides ?? {});
  const list = key => process.env[key]?.split(',').map(value=>value.trim()).filter(Boolean);
  merged.account_holder_patterns = list('ACCOUNT_HOLDER_PATTERNS') ?? merged.account_holder_patterns;
  merged.revolut_account_patterns = list('REVOLUT_ACCOUNT_PATTERNS') ?? merged.revolut_account_patterns;
  merged.known_income_patterns = list('KNOWN_INCOME_PATTERNS') ?? merged.known_income_patterns;
  merged.workbook = process.env.WORKBOOK_PATH ?? merged.workbook;
  for (const [key,env] of [['dbs','DBS_SOURCE_PATH'],['paylah','PAYLAH_SOURCE_PATH'],['revolut','REVOLUT_SOURCE_PATH']]) merged.sources[key] = process.env[env] ?? merged.sources[key];
  const rel = merged.relationship_account;
  for (const [key,env] of [['account_id','RELATIONSHIP_ACCOUNT_ID'],['account_name','RELATIONSHIP_ACCOUNT_NAME'],['user_label','RELATIONSHIP_USER_LABEL'],['partner_label','RELATIONSHIP_PARTNER_LABEL']]) rel[key] = process.env[env] ?? rel[key];
  rel.personal_funding_account_ids = list('PERSONAL_FUNDING_ACCOUNT_IDS') ?? rel.personal_funding_account_ids;
  rel.partner_funding_account_ids = list('PARTNER_FUNDING_ACCOUNT_IDS') ?? rel.partner_funding_account_ids;
  settings = validateSettings(merged);
  paths = {workbook:settings.workbook,merchantDirectory:settings.merchant_directory,sources:settings.sources};
  categories = Object.values(settings.categories).map(category=>category.name);
  categorySubcategories = subcategoriesFrom(settings);
  relationshipAccount = { accountId:rel.account_id,accountName:rel.account_name,userLabel:rel.user_label,partnerLabel:rel.partner_label,otherContributorLabel:rel.other_contributor_label,startDate:rel.start_date,personalFundingAccountIds:rel.personal_funding_account_ids,partnerFundingAccountIds:rel.partner_funding_account_ids };
  knownIncomePatterns = settings.known_income_patterns;
  accountHolderPatterns = settings.account_holder_patterns;
  revolutAccountPatterns = settings.revolut_account_patterns;
  incomeSourceRules = Object.entries(settings.income_sources).flatMap(([name,patterns])=>patterns.map(pattern=>({name,pattern})));
  transferMatching = {maxCalendarDays:settings.transfer_matching.max_calendar_days,amountToleranceSgd:settings.transfer_matching.amount_tolerance_sgd};
  return settings;
}
reloadConfig();
