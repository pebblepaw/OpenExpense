import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { mergeSettings, validateSettings, canonicalCategoryFrom, subcategoriesFrom, publicSettings } from '../src/settings.mjs';
import { resolveAutomaticSubcategory } from '../src/subcategories.mjs';
import { reloadConfig, settings, accountNameFor, closingBalanceFor } from '../src/config.mjs';
import { classifyTransactions, loadMerchantRules } from '../src/classify.mjs';

const defaults = parse(await readFile(new URL('../config/defaults.yaml',import.meta.url),'utf8'));

test('YAML supports nested settings, lists, comments, hex colors and explicit empty lists', () => {
  const override = parse('app:\n  name: "Example #1" # comment\ncategories:\n  food:\n    color: "#ff6600"\naccount_holder_patterns: []\n');
  const config = validateSettings(mergeSettings(defaults,override));
  assert.equal(config.app.name,'Example #1');
  assert.equal(config.categories.food.color,'#ff6600');
  assert.deepEqual(config.account_holder_patterns,[]);
  assert.equal(config.categories.food.amount_bands[0].min,50);
  assert.equal(defaults.app.name,'OpenExpense');
  assert.throws(()=>parse('app: [broken'),/end|flow|collection/i);
});

test('validation rejects conflicting aliases, bad regexes, dates and ambiguous amount bands', () => {
  for (const override of [
    {categories:{shopping:{name:'Food & Dining'}}},
    {categories:{food:{amount_bands:[{min:20,name:'Small'},{min:50,name:'Large'}]}}},
    {categories:{transport:{match_rules:[{pattern:'[',name:'Invalid'}]}}},
    {analysis:{start_date:'2026-02-30'}},
    {forecast:{recent_months:0}}
  ]) assert.throws(()=>validateSettings(mergeSettings(defaults,override)),/Invalid OpenExpense configuration/);
});

test('renamed categories retain old aliases while arbitrary categories and amount bands are supported', () => {
  const config = validateSettings(mergeSettings(defaults,{categories:{
    food:{name:'Meals',amount_bands:[{min:40,name:'Large meal'},{min:15,name:'Medium meal'},{min:0,name:'Small meal'}]},
    pets:{name:'Pet care',color:'#ff6600',aliases:['Pets'],subcategories:['Vet'],default_subcategory:'Vet'}
  }}));
  assert.equal(canonicalCategoryFrom(config,'Food & Dining'),'Meals');
  assert.equal(canonicalCategoryFrom(config,'Transfer to Friends/Others'),'Transfers to People');
  for (const [amount,name] of [[14.99,'Small meal'],[15,'Medium meal'],[39.99,'Medium meal'],[40,'Large meal']]) assert.equal(resolveAutomaticSubcategory({category:'Meals',amountSgd:-amount,definitions:config.categories}),name);
  assert.equal(resolveAutomaticSubcategory({category:'Pet care',amountSgd:-35,definitions:config.categories}),'Vet');
  assert.ok(subcategoriesFrom(config).Meals.includes('Large meal'));
});

test('dashboard settings never include owner patterns, account IDs, paths or demo private overrides', () => {
  const config = mergeSettings(defaults,{accounts:{'PRIVATE-ID':{name:'Private account'}},account_holder_patterns:['Private Owner'],workbook:'/private/ledger.xlsx',relationship_account:{account_id:'PRIVATE-JOINT-ID'}});
  const encoded = JSON.stringify(publicSettings(config));
  for (const secret of ['PRIVATE-ID','Private Owner','PRIVATE-JOINT-ID','/private/ledger.xlsx']) assert.ok(!encoded.includes(secret));
  assert.equal(publicSettings(config).categories.food.name,'Food & Dining');
});

test('config reload updates account aliases, classifier mappings and subcategories together without a build', async context => {
  const temporary = await mkdtemp(join(tmpdir(),'openexpense-yaml-test-'));
  const oldPath = process.env.OPENEXPENSE_CONFIG;
  context.after(async()=>{if(oldPath === undefined)delete process.env.OPENEXPENSE_CONFIG;else process.env.OPENEXPENSE_CONFIG=oldPath;reloadConfig();await rm(temporary,{recursive:true,force:true});});
  const file = join(temporary,'settings.yaml');
  await writeFile(file,stringify({accounts:{'DEMO-ALIAS':{name:'Rainy day fund',closing_balance:42}},relationship_account:{account_name:'Our fund'},categories:{food:{name:'Meals',amount_bands:[{min:40,name:'Large meal'},{min:0,name:'Other meal'}]},groceries:{name:'Market'}}}));
  process.env.OPENEXPENSE_CONFIG = file;
  reloadConfig();
  assert.equal(accountNameFor({accountId:'DEMO-ALIAS',accountName:'Original'}),'Rainy day fund');
  assert.equal(closingBalanceFor({accountId:'DEMO-ALIAS',source:'dbs-csv'}),42);
  assert.equal(settings.relationship_account.account_name,'Our fund');
  const rules = await loadMerchantRules();
  assert.equal(rules.find(rule=>rule.pattern==='FAIRPRICE').category,'Market');
  const [meal] = await classifyTransactions([{id:'test',descriptionRaw:'Test meal',amountSgd:-40,manualCategory:'Food & Dining'}],{rules:[]});
  assert.equal(meal.category,'Meals');assert.equal(meal.subcategory,'Large meal');
  await writeFile(file,stringify({categories:{food:{name:'Dinner',amount_bands:[{min:0,name:'Dinner payment'}]}}}));
  reloadConfig();
  const [retag] = await classifyTransactions([{id:'test',descriptionRaw:'Test meal',amountSgd:-40,manualCategory:'Food & Dining'}],{rules:[]});
  assert.equal(retag.category,'Dinner');assert.equal(retag.subcategory,'Dinner payment');
});
