import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = resolve(dirname(fileURLToPath(import.meta.url)), '../config');
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseSimpleYaml(text) {
  const result = {};
  let currentKey = null;
  let currentNestedKey = null;
  const lines = text.split('\n');
  for (let rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    if (trimmed.startsWith('-')) {
      const val = trimmed.slice(1).trim().replace(/^['"]|['"]$/g, '');
      if (currentNestedKey && typeof result[currentKey] === 'object' && Array.isArray(result[currentKey][currentNestedKey])) {
        result[currentKey][currentNestedKey].push(val);
      } else if (currentKey && Array.isArray(result[currentKey])) {
        result[currentKey].push(val);
      }
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (indent === 0) {
        currentKey = key;
        currentNestedKey = null;
        if (!val) {
          result[key] = [];
        } else {
          result[key] = val;
        }
      } else {
        if (!result[currentKey] || Array.isArray(result[currentKey])) {
          result[currentKey] = {};
        }
        if (!val) {
          result[currentKey][key] = [];
          currentNestedKey = key;
        } else {
          result[currentKey][key] = val;
          currentNestedKey = null;
        }
      }
    }
  }
  return result;
}

function loadConfigFile() {
  const possiblePaths = [
    resolve(configDir, 'config.yaml'),
    resolve(configDir, 'config.yml'),
    resolve(rootDir, 'config.yaml'),
    resolve(rootDir, 'config.yml')
  ];
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      try {
        return parseSimpleYaml(readFileSync(path, 'utf8'));
      } catch {
        // Fall back
      }
    }
  }
  return {};
}

try {
  if (typeof process.loadEnvFile === 'function') {
    const envPath = resolve(rootDir, '.env');
    if (existsSync(envPath)) process.loadEnvFile(envPath);
  }
} catch {
  // Ignore
}

const fileConfig = loadConfigFile();

function listFromEnvOrConfig(envKey, configKey, defaultValue = []) {
  if (process.env[envKey]) {
    return process.env[envKey].split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(fileConfig[configKey]) && fileConfig[configKey].length > 0) {
    return fileConfig[configKey];
  }
  return defaultValue;
}

export const paths = {
  workbook: fileConfig.workbook ?? process.env.WORKBOOK_PATH ?? './master_transactions.xlsx',
  merchantDirectory: './config/merchant_directory.csv',
  sources: {
    dbs: fileConfig.sources?.dbs ?? process.env.DBS_SOURCE_PATH ?? './POSB:DBS Bank Statement',
    paylah: fileConfig.sources?.paylah ?? process.env.PAYLAH_SOURCE_PATH ?? './PayLah',
    revolut: fileConfig.sources?.revolut ?? process.env.REVOLUT_SOURCE_PATH ?? './Revolut'
  }
};

export const categories = JSON.parse(readFileSync(resolve(configDir, 'categories.json'), 'utf8'));

const relConfig = fileConfig.relationship_account ?? {};
export const relationshipAccount = {
  accountId: process.env.RELATIONSHIP_ACCOUNT_ID ?? relConfig.account_id ?? 'JOINT_ACCOUNT_ID',
  accountName: process.env.RELATIONSHIP_ACCOUNT_NAME ?? relConfig.account_name ?? 'Joint Account',
  userLabel: process.env.RELATIONSHIP_USER_LABEL ?? relConfig.user_label ?? 'You',
  partnerLabel: process.env.RELATIONSHIP_PARTNER_LABEL ?? relConfig.partner_label ?? 'Partner',
  personalFundingAccountIds: process.env.PERSONAL_FUNDING_ACCOUNT_IDS
    ? process.env.PERSONAL_FUNDING_ACCOUNT_IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : (Array.isArray(relConfig.personal_funding_account_ids) ? relConfig.personal_funding_account_ids : []),
  partnerFundingAccountIds: process.env.PARTNER_FUNDING_ACCOUNT_IDS
    ? process.env.PARTNER_FUNDING_ACCOUNT_IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : (Array.isArray(relConfig.partner_funding_account_ids) ? relConfig.partner_funding_account_ids : [])
};

export const knownIncomePatterns = listFromEnvOrConfig(
  'KNOWN_INCOME_PATTERNS',
  'known_income_patterns',
  ['GOVTECH', 'MINDEF', 'SAF']
);

// Optional private YAML overrides add counterparties without putting names in Git.
export const incomeSourceRules = Object.entries({
  ...JSON.parse(readFileSync(resolve(configDir, 'income_sources.json'), 'utf8')),
  ...(fileConfig.income_sources ?? {})
}).flatMap(([name, patterns]) => (Array.isArray(patterns) ? patterns : []).map(pattern => ({ name, pattern })));

export const accountHolderPatterns = listFromEnvOrConfig(
  'ACCOUNT_HOLDER_PATTERNS',
  'account_holder_patterns',
  []
);

export const revolutAccountPatterns = listFromEnvOrConfig(
  'REVOLUT_ACCOUNT_PATTERNS',
  'revolut_account_patterns',
  []
);

export const transferMatching = {
  maxCalendarDays: 3,
  amountToleranceSgd: 0.01
};
