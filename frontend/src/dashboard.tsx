import {
  ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Info, Moon, RefreshCw,
  Sparkles, Sun, Target, Users, WalletCards, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { TransactionsView } from '@/components/finance/transactions';
import { CalendarView } from '@/components/finance/calendar';
import { reportingPeriodIndices } from '../../src/reporting-periods.mjs';
import {
  adaptFinanceData, categoryBreakdown, changePercent, dateLabel, expenseRows, incomeBreakdown, incomeRows, incomeSource, isDemoMode, loadFinanceData,
  money, monthLabel, periodKeys, previousPeriodKeys, refreshFinanceData, saveRecipientAlias, saveTransaction,
  subcategoryBreakdown, totalPeriod,
  type AccountScope, type ApiData, type CategoryInfo, type FinanceModel, type Monthly,
  type Period, type Transaction, type TransactionPatch,
} from '@/lib/finance-data';
import { cn } from '@/lib/utils';

type View = 'Overview' | 'Calendar' | 'Categories' | 'Transactions';
type Theme = 'dark' | 'light';
type ChartMode = 'Flow' | 'Balance' | 'Saved' | 'Categories';
const axisMoney = (value: number) => Math.abs(value) >= 1000 ? `${value < 0 ? '−' : ''}$${(Math.abs(value) / 1000).toFixed(1)}k` : money(value);

export default function FinanceDashboard() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<View>('Overview');
  const [scope, setScope] = useState<AccountScope>('Personal');
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('flow-theme') === 'light' ? 'light' : 'dark');
  const [month, setMonth] = useState('');
  const [period, setPeriod] = useState<Period>('Month');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [focus, setFocus] = useState<Transaction | null>(null);
  const [panel, setPanel] = useState<'forecast' | 'sources' | null>(null);
  const model = useMemo(() => data ? adaptFinanceData(data) : null, [data]);
  const reload = async () => {
    setLoadError('');
    try { const next = await loadFinanceData(); setData(next); setMonth(current => current || next.coverage.latestDate.slice(0, 7)); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not load your financial data.'); }
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (!data) return;
    document.title = data.settings.app.name;
    setSelectedCategory(current => data.categories.includes(current) ? current : data.settings.categories[data.settings.app.default_category].name);
  }, [data]);
  useEffect(() => { document.documentElement.classList.toggle('light', theme === 'light'); localStorage.setItem('flow-theme', theme); }, [theme]);
  const onSave = async (id: string, patch: TransactionPatch) => { setData(await saveTransaction(id, patch)); };
  const onRecipientAlias = async (number: string, name: string) => { setData(await saveRecipientAlias(number, name)); };
  const onRefresh = async () => { const next = await refreshFinanceData(); setData(next); };
  const openTransaction = (row: Transaction) => { setScope(row.scope); setFocus(row); setView('Transactions'); };
  const openCategories = (category?: string) => { if (category) setSelectedCategory(category); setView('Categories'); };
  if (!model) return <main className="app-shell loading-shell"><div className="projection-card"><WalletCards className="size-7 text-brand"/><h1 className="mt-4 text-xl font-semibold">{loadError ? 'Your data could not be loaded' : 'Loading OpenExpense'}</h1><p className="mt-2 text-sm text-muted-foreground">{loadError || 'Reading your ledger…'}</p>{loadError && <Button className="mt-5" onClick={() => void reload()}>Try again</Button>}</div></main>;
  const activeKeys = periodKeys(month, period, model.monthKeys);
  return <main className="app-shell">
    <header className="topbar">
      <div className="scope-switch" role="group" aria-label="Reporting period">
        {(['Month', 'Quarter', 'Year'] as Period[]).map(item => <button key={item} onClick={() => { setPeriod(item); const selected = reportingPeriodIndices(model.monthKeys,item).find(index=>index.months.includes(month)); if (selected) setMonth(selected.month); }} aria-pressed={period === item} className={cn('scope-option', period === item && 'scope-option-active')}>{item}</button>)}
      </div>
      <nav className="view-tabs" aria-label="Dashboard views">
        {(['Overview', 'Calendar', 'Categories', 'Transactions'] as View[]).map(item => <button key={item} onClick={() => { if (item === 'Transactions') setFocus(null); setView(item); }} aria-pressed={view === item} className={cn('view-tab', view === item && 'view-tab-active')}>{item}</button>)}
      </nav>
      <div className="flex items-center justify-end gap-2">
        <div className="scope-switch">
          <button aria-label="Personal finances" title={model.data.settings.app.personal_label} onClick={() => { setFocus(null); setScope('Personal'); }} className={cn('scope-option', scope === 'Personal' && 'scope-option-active')}><WalletCards className="size-4"/><span className="hidden xl:inline">{model.data.settings.app.personal_label}</span></button>
          <button aria-label={model.data.relationship.accountName} title={model.data.relationship.accountName} onClick={() => { setFocus(null); setScope('Shared'); }} className={cn('scope-option', scope === 'Shared' && 'scope-option-active')}><Users className="size-4"/><span className="hidden xl:inline">{model.data.relationship.accountName}</span></button>
        </div>
        <Button variant="icon" size="icon" aria-label="Accounts and source coverage" title="Accounts and source coverage" onClick={() => setPanel('sources')}><Info className="size-4"/></Button>
        <Button variant="icon" size="icon" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun className="size-4"/> : <Moon className="size-4"/>}</Button>
      </div>
    </header>
    <div className="period-row"><PeriodRuler keys={model.monthKeys} period={period} value={month} onChange={setMonth}/></div>
    <section className="dashboard-stage">
      {view === 'Overview' && <Overview model={model} scope={scope} month={month} period={period} selectedCategory={selectedCategory} onCategories={openCategories} onTransaction={openTransaction} onForecast={() => setPanel('forecast')} onSources={() => setPanel('sources')} onMonthChange={setMonth}/>}
      {view === 'Calendar' && <CalendarView rows={model.transactions} scope={scope} month={month} monthKeys={model.monthKeys} categories={model.categories} onMonthChange={setMonth} onTransaction={openTransaction}/>}
      {view === 'Categories' && <CategoriesView model={model} scope={scope} month={month} period={period} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} onMonthChange={setMonth} onTransaction={openTransaction}/>}
      {view === 'Transactions' && <TransactionsView rows={model.transactions} scope={scope} month={month} period={period} monthKeys={model.monthKeys} activeKeys={activeKeys} focusedTransaction={focus} categories={model.data.categories} subcategories={model.data.subcategories} onSave={onSave} onRecipientAlias={onRecipientAlias} onRefresh={onRefresh}/>}
    </section>
    <Drawer open={panel === 'forecast'} onClose={() => setPanel(null)} title="Savings estimator"><ForecastPanel model={model}/></Drawer>
    <Drawer open={panel === 'sources'} onClose={() => setPanel(null)} title="Accounts & coverage"><SourcesPanel model={model} onRefresh={onRefresh}/></Drawer>
  </main>;
}

function PeriodRuler({ keys, period, value, onChange }: { keys: string[]; period: Period; value: string; onChange: (month: string) => void }) {
  const indices = reportingPeriodIndices(keys,period);
  const width = Math.min(620,indices.length*68+28);
  return <div className="month-ruler" aria-label={`Reporting ${period.toLowerCase()}`} style={{width:`min(${width}px,100%)`}}><div className="month-ruler-track" style={{ gridTemplateColumns: `repeat(${Math.max(1,indices.length)},minmax(36px,1fr))`, minWidth: `${indices.length*36}px` }}>{indices.map((item, index) => { const selected = item.months.includes(value); return <button key={item.id} onClick={event => { onChange(item.month); event.currentTarget.blur(); }} className={cn('month-tick', selected && 'month-tick-active')} aria-label={period === 'Month' ? monthLabel(item.month,true) : item.id.replace('-',' ')} aria-pressed={selected}><i style={{ height: `${index % 3 === 0 ? 13 : index % 2 === 0 ? 9 : 6}px` }}/><span>{period === 'Month' ? monthLabel(item.month) : item.label}</span></button>; })}</div></div>;
}

function Stat({ label, value, previous, priorAvailable, inverse = false, accent, comparison }: { label: string; value: number; previous: number; priorAvailable: boolean; inverse?: boolean; accent: string; comparison: string }) {
  const change = priorAvailable ? changePercent(value, previous) : null;
  const delta = value - previous, good = inverse ? delta <= 0 : delta >= 0;
  return <div className="metric-card group"><div className="flex items-center justify-between gap-1"><span className="eyebrow">{label}</span><span className={cn('metric-change-chip', accent)}>{change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}</span></div><p className="mt-3 text-[clamp(1.4rem,2.2vw,2.25rem)] font-semibold leading-none tracking-normal">{money(value)}</p><div className={cn('mt-3 text-[11px] font-semibold', good ? 'text-positive' : 'text-negative')}>{priorAvailable ? <>{delta >= 0 ? '+' : '−'}{money(Math.abs(delta))} <span className="font-normal text-muted-foreground">vs {comparison}</span></> : <span className="font-normal text-muted-foreground">No prior period</span>}</div></div>;
}

type OverviewProps = { model: FinanceModel; scope: AccountScope; month: string; period: Period; selectedCategory: string; onCategories: (category?: string) => void; onTransaction: (row: Transaction) => void; onForecast: () => void; onSources: () => void; onMonthChange: (month: string) => void };
function Overview({ model, scope, month, period, selectedCategory, onCategories, onTransaction, onForecast, onSources, onMonthChange }: OverviewProps) {
  const [chartMode, setChartMode] = useState<ChartMode>('Flow');
  const [trendCategory, setTrendCategory] = useState('All categories');
  const [rankMode, setRankMode] = useState<'Categories' | 'Largest'>('Categories');
  const series = scope === 'Personal' ? model.personal : model.shared;
  const keys = periodKeys(month, period, model.monthKeys), priorKeys = previousPeriodKeys(month, period, model.monthKeys);
  const latest = totalPeriod(series, keys), previous = totalPeriod(series, priorKeys);
  const categoryValues = categoryBreakdown(model, scope, keys, priorKeys);
  const categoryMax = Math.max(1, ...categoryValues.map(category => category.value));
  const categoryTotal = categoryValues.reduce((sum, category) => sum + category.value, 0);
  const monthData = series.find(row => row.month === month);
  const latestBalance = scope === 'Personal' ? monthData?.balance : model.data.relationship.availableBalanceSgd;
  const ytdSaved = totalPeriod(series, periodKeys(month, 'Year', model.monthKeys)).savings;
  const savingsRate = latest.income > 0 ? Math.round(latest.savings / latest.income * 100) : null;
  const periodLabel = period === 'Month' ? monthLabel(month) : period === 'Quarter' ? `Q${Math.ceil(Number(month.slice(5)) / 3)}` : `${month.slice(0, 4)} YTD`;
  const comparison = period === 'Month' && priorKeys[0] ? monthLabel(priorKeys[0]) : period === 'Quarter' ? 'prior quarter' : 'prior period';
  const biggest = expenseRows(model.transactions, scope, keys).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 12);
  const graphMonths = series;
  const categoryChart = groupedCategoryChart(model, scope);
  const chartData = chartMode === 'Categories' && trendCategory !== 'All categories' ? graphMonths.map(row => ({ ...row, value: row.categories[trendCategory] ?? 0 })) : chartMode === 'Categories' ? categoryChart.rows : graphMonths;
  const chooseChartMonth = (state: any) => { const key = graphMonths.find(row => row.label === state?.activeLabel)?.month; if (key) onMonthChange(key); };
  return <div className="overview-grid animate-view">
    <section className="summary-panel">
      <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{periodLabel} {scope === 'Personal' ? 'cash flow' : 'shared account'}</p><h2 className="mt-1 text-xl font-semibold">Income, spending & what stayed</h2></div><span className="month-pill">{periodLabel}{monthData?.partial ? ' · partial' : ''}</span></div>
      <div className="mt-4 grid grid-cols-3 gap-2.5"><Stat label={scope === 'Personal' ? 'Net income' : 'Contributions'} value={latest.income} previous={previous.income} priorAvailable={priorKeys.length > 0} comparison={comparison} accent="text-positive bg-positive-soft"/><Stat label={scope === 'Personal' ? 'Net spend' : 'Shared spend'} value={latest.spending} previous={previous.spending} priorAvailable={priorKeys.length > 0} comparison={comparison} inverse accent="text-negative bg-negative-soft"/><Stat label="Saved" value={latest.savings} previous={previous.savings} priorAvailable={priorKeys.length > 0} comparison={comparison} accent={latest.savings >= 0 ? 'text-brand bg-brand-soft' : 'text-negative bg-negative-soft'}/></div>
      <div className="chart-header mt-5 gap-2"><div><div className="analysis-switch">{(['Flow', 'Balance', 'Saved', 'Categories'] as ChartMode[]).map(mode => <button key={mode} className={cn(chartMode === mode && 'analysis-option-active')} onClick={() => setChartMode(mode)}>{mode}</button>)}</div><p className="mt-2 text-xs text-muted-foreground">{chartMode === 'Flow' ? <><span className="legend-dot bg-brand"/>{scope === 'Personal' ? 'Income' : 'Funding'} <span className="ml-3 legend-dot bg-coral"/>Net spend <span className="ml-3 legend-dot bg-lime"/>Saved</> : chartMode === 'Balance' ? scope === 'Personal' ? 'Combined personal balance · estimated history where sources are incomplete' : 'Shared available balance is shown in the account card' : chartMode === 'Saved' ? 'Income less net personal spending, each month' : 'Gross category spending · repayments shown separately'}</p></div>{chartMode === 'Categories' && <select className="chart-filter" aria-label="Trend category" value={trendCategory} onChange={event => setTrendCategory(event.target.value)}><option>All categories</option>{model.categories.map(category => <option key={category.name}>{category.name}</option>)}</select>}</div>
      <div className="flow-chart min-h-[260px] min-w-0 flex-1">
        {chartMode === 'Balance' && scope === 'Shared' ? <div className="chart-empty"><Users className="size-8 text-brand"/><p>Shared contributions and spending are tracked separately.</p><strong>{money(model.data.relationship.availableBalanceSgd ?? 0)} available</strong></div> : <ResponsiveContainer width="100%" height="100%">
          {chartMode === 'Categories' ? <BarChart data={chartData} onClick={chooseChartMonth} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}/><YAxis domain={[0, 'auto']} width={52} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} tickFormatter={axisMoney}/><Tooltip content={<ChartTip/>}/><ReferenceLine y={0} stroke="var(--border-strong)"/>{trendCategory === 'All categories' ? categoryChart.groups.map(category => <Bar key={category.name} name={category.name} dataKey={category.name} stackId="spend" fill={category.color}/>) : <Bar name={trendCategory} dataKey="value" fill={model.categories.find(category => category.name === trendCategory)?.color ?? 'var(--chart-1)'} radius={[4, 4, 0, 0]}/>}</BarChart> : chartMode === 'Saved' ? <BarChart stackOffset="sign" data={graphMonths} onClick={chooseChartMonth} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}/><YAxis width={52} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} tickFormatter={axisMoney}/><Tooltip content={<ChartTip/>}/><ReferenceLine y={0} stroke="var(--border-strong)"/><Bar dataKey="savings" name="Saved" fill="var(--chart-3)" radius={[5, 5, 0, 0]}/></BarChart> : <AreaChart data={graphMonths} onClick={chooseChartMonth} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}><defs><linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32}/><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}/><YAxis width={52} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} tickFormatter={axisMoney}/><Tooltip content={<ChartTip/>} cursor={{ stroke: 'var(--border-strong)' }}/>{chartMode === 'Balance' ? <Area type="monotone" dataKey="balance" name="Combined balance" stroke="var(--chart-1)" fill="url(#incomeFill)" strokeWidth={3} connectNulls={false} activeDot={{ r: 5, fill: 'var(--chart-1)', stroke: 'var(--background)', strokeWidth: 3 }}/> : <><Area type="monotone" dataKey="income" name={scope === 'Personal' ? 'Net income' : 'Contributions'} stroke="var(--chart-1)" fill="url(#incomeFill)" strokeWidth={3} activeDot={{ r: 5, fill: 'var(--chart-1)', stroke: 'var(--background)', strokeWidth: 3 }}/><Area type="monotone" dataKey="spending" name="Net spending" stroke="var(--chart-2)" fill="transparent" strokeWidth={2.5} activeDot={{ r: 4 }}/><Area type="monotone" dataKey="savings" name="Saved" stroke="var(--chart-3)" fill="transparent" strokeWidth={2.5} activeDot={{ r: 4 }}/></>}</AreaChart>}
        </ResponsiveContainer>}
      </div>
      <div className="flow-footer"><span>{scope === 'Personal' ? `${money(latest.grossSpend)} paid · ${money(latest.receipts)} returned` : `${model.data.relationship.userLabel} ${money(latest.userFunding)} · ${model.data.relationship.partnerLabel} / other ${money(latest.partnerFunding)}`}</span><span>Click a month to inspect it</span></div>
      {chartMode === 'Categories' && trendCategory === 'All categories' && <div className="chart-legend">{categoryChart.groups.map(category => category.name === 'Other' ? <span key={category.name}><i style={{ background: category.color }}/>{category.name}</span> : <button key={category.name} onClick={() => setTrendCategory(category.name)}><i style={{ background: category.color }}/>{category.name}</button>)}</div>}
    </section>
    <section className="savings-card insight-card">
      <div className="flex items-center justify-between"><div><p className="eyebrow">{scope === 'Personal' ? `Combined balance · ${monthLabel(month)}` : 'Relationship account balance'}</p><button onClick={onSources} className="mt-2 text-left text-3xl font-semibold">{latestBalance === null || latestBalance === undefined ? '—' : money(latestBalance)}</button></div><span className="metric-icon bg-brand-soft text-brand"><WalletCards className="size-4"/></span></div>
      <p className="mt-2 text-[10px] text-muted-foreground">{scope === 'Personal' ? monthData?.estimated ? 'Estimated · incomplete source history' : monthData?.partial ? `Available balance through ${dateLabel(model.data.coverage.latestDate)}` : 'Combined month-end balance' : `Available · ledger ${money(model.data.relationship.ledgerBalanceSgd ?? 0)}`}</p>
      {scope === 'Personal' ? <><div className="savings-goal-label mt-4"><span>Savings rate</span><span>{savingsRate === null ? 'No income this period' : `${savingsRate}%`}</span></div><div className="savings-gauge mt-2"><div style={{ width: `${Math.max(0, Math.min(savingsRate ?? 0, 100))}%` }}/></div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4"><div><p className="eyebrow">YTD saved</p><p className={cn('mt-1 text-xl font-semibold', ytdSaved < 0 && 'text-negative')}>{money(ytdSaved)}</p></div><button onClick={onForecast} className="text-left"><p className="eyebrow">{monthLabel(model.data.settings.forecast.target_month ?? `${month.slice(0,4)}-12`)} balance</p><p className="mt-1 text-xl font-semibold">{money(model.data.metrics.projectedYearEndBalanceSgd)}</p></button></div><button onClick={onForecast} className="recommendation mt-4"><span><strong><Sparkles className="mr-1 inline size-3 text-lime"/>Savings estimator</strong><small>Adjust income and spending assumptions</small></span><ChevronRight className="size-4 shrink-0"/></button></> : <><div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4"><div><p className="eyebrow">{model.data.relationship.userLabel} funding</p><p className="mt-1 text-xl font-semibold">{money(latest.userFunding)}</p></div><div><p className="eyebrow">{model.data.relationship.partnerLabel} / other</p><p className="mt-1 text-xl font-semibold">{money(latest.partnerFunding)}</p></div></div><p className="mt-3 text-[10px] text-muted-foreground">Personal contributions are counted once as transfers to this account.</p></>}
    </section>
    <section className="category-card">
      <div className="flex items-start justify-between gap-2"><div><p className="eyebrow">Where it went · {periodLabel}</p><h3 className="mt-1 text-base font-semibold">{rankMode === 'Categories' ? 'Ranked spending' : 'Largest purchases'}</h3></div><div className="analysis-switch">{(['Categories', 'Largest'] as const).map(mode => <button key={mode} onClick={() => setRankMode(mode)} className={cn(rankMode === mode && 'analysis-option-active')}>{mode}</button>)}</div></div>
      <div className="ranked-list mt-4 min-h-0 flex-1 space-y-3">{rankMode === 'Categories' ? categoryValues.map(category => { const delta = priorKeys.length ? changePercent(category.value, category.previous) : null; return <button key={category.name} onClick={() => onCategories(category.name)} className={cn('category-bar-row', selectedCategory === category.name && 'category-bar-row-active')}><span className="category-bar-label"><strong>{category.name}</strong><em>{money(category.value)} <span className={delta !== null && delta <= 0 ? 'text-positive' : 'text-negative'}>{delta === null ? '' : `${delta > 0 ? '+' : ''}${delta}%`}</span></em></span><span className="category-bar-track"><i style={{ width: `${category.value / categoryMax * 100}%`, background: category.color }}/></span></button>; }) : biggest.map(row => <button key={row.id} onClick={() => onTransaction(row)} className="purchase-link"><span className="min-w-0"><strong>{row.merchant}</strong><small>{dateLabel(row.date)} · {row.category}</small></span><em>{money(-row.amount, 2)}</em></button>)}{categoryValues.length === 0 && <p className="text-xs text-muted-foreground">No spending recorded in this period.</p>}</div><button onClick={() => onCategories()} className="ranking-footer"><span>{money(categoryTotal)} gross category spend</span><ChevronRight className="size-3"/></button>
    </section>
  </div>;
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return <div className="chart-tip"><p className="mb-1 text-[10px] text-muted-foreground">{label}{point?.partial ? ' · partial' : ''}{point?.estimated ? ' · estimated balance' : ''}</p>{payload.filter((entry: any) => entry.value !== null && entry.value !== undefined && Number(entry.value) !== 0).map((entry: any) => <div key={entry.dataKey} className="flex justify-between gap-5 text-xs"><span><i className="legend-dot" style={{ background: entry.color }}/>{entry.name ?? entry.dataKey}</span><strong>{money(entry.value, 2)}</strong></div>)}</div>;
}

function groupedCategoryChart(model: FinanceModel, scope: AccountScope) {
  const series = scope === 'Personal' ? model.personal : model.shared;
  const ranked = categoryBreakdown(model, scope, model.monthKeys);
  const total = ranked.reduce((sum, category) => sum + category.value, 0);
  const options = model.data.settings.app.chart;
  const main = ranked.filter((category, index) => index < options.max_categories && category.value >= total * options.minimum_category_share);
  const minor = ranked.filter(category => !main.some(entry => entry.name === category.name));
  const groups = [...main, ...(minor.length ? [{ name: options.other_label, value: 0, previous: 0, color: 'var(--chart-muted)' }] : [])];
  const rows = series.map(row => ({ label: row.label, month: row.month, partial: row.partial, ...Object.fromEntries(main.map(category => [category.name, row.categories[category.name] ?? 0])), [options.other_label]: minor.reduce((sum, category) => sum + (row.categories[category.name] ?? 0), 0) }));
  return { rows, groups };
}

function CategoriesView({ model, scope, month, period, selectedCategory, setSelectedCategory, onMonthChange, onTransaction }: { model: FinanceModel; scope: AccountScope; month: string; period: Period; selectedCategory: string; setSelectedCategory: (value: string) => void; onMonthChange: (month: string) => void; onTransaction: (row: Transaction) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<'Spending' | 'Income'>('Spending');
  const [selectedIncome, setSelectedIncome] = useState('');
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const isIncome = analysis === 'Income';
  const series = scope === 'Personal' ? model.personal : model.shared;
  const keys = periodKeys(month, period, model.monthKeys), prior = previousPeriodKeys(month, period, model.monthKeys);
  const categories = isIncome ? incomeBreakdown(model, scope, keys, prior) : categoryBreakdown(model, scope, keys, prior);
  const selection = isIncome ? selectedIncome : selectedCategory;
  const selected = categories.find(category => category.name === selection) ?? categories[0] ?? (!isIncome ? model.categories.find(category => category.name === selection) : undefined);
  const rows = isIncome ? incomeRows(model.transactions, scope, keys) : expenseRows(model.transactions, scope, keys);
  const groupFor = (row: Transaction) => isIncome ? incomeSource(row) : row.category;
  const selectedRows = selected ? rows.filter(row => groupFor(row) === selected.name && (!subcategory || (row.subcategory || 'Other') === subcategory)) : [];
  const allIncome = incomeRows(model.transactions, scope);
  const incomeGroups = incomeBreakdown(model, scope, model.monthKeys);
  const incomeTrend = series.map(month => ({
    label: month.label, month: month.month, partial: month.partial,
    ...Object.fromEntries(incomeGroups.map(group => [group.name, allIncome.filter(row => row.date.startsWith(month.month) && incomeSource(row) === group.name).reduce((sum, row) => sum + row.amount, 0)]))
  }));
  const chart = isIncome ? { rows: incomeTrend, groups: incomeGroups } : groupedCategoryChart(model, scope);
  const trendData = series.map(month => ({
    label: month.label, month: month.month, partial: month.partial,
    value: isIncome ? allIncome.filter(row => row.date.startsWith(month.month) && incomeSource(row) === selected?.name).reduce((sum, row) => sum + row.amount, 0) : month.categories[selected?.name ?? ''] ?? 0
  }));
  const categoryTotal = categories.reduce((sum, category) => sum + category.value, 0);
  const delta = prior.length && selected ? changePercent(selected.value, selected.previous) : null;
  const amount = showAll ? categoryTotal : selected?.value ?? 0;
  const incomeLabel = scope === 'Shared' ? 'Account contributions' : 'Income sources';
  useEffect(() => { setSubcategory(null); setLimit(60); }, [month, period, scope, analysis, selection]);
  const chooseMonth = (state: any) => { const key = series.find(row => row.label === state?.activeLabel)?.month; if (key) onMonthChange(key); };
  const chooseGroup = (name: string) => {
    if (isIncome) setSelectedIncome(name);
    else {
      setSelectedCategory(name);
      setExpandedCategory(current => current === name ? null : name);
    }
    setSubcategory(null);
  };
  return <div className="categories-layout animate-view">
    <aside className="category-index">
      <div className="analysis-switch" aria-label="Category analysis">
        {(['Spending', 'Income'] as const).map(item => <button key={item} aria-pressed={analysis === item} onClick={() => setAnalysis(item)} className={cn(analysis === item && 'analysis-option-active')}>{item}</button>)}
      </div>
      <div><p className="eyebrow">{isIncome ? incomeLabel : 'Spending categories'}</p><h2 className="mt-1 text-xl font-semibold">{period === 'Month' ? monthLabel(month) : period === 'Quarter' ? `Q${Math.ceil(Number(month.slice(5)) / 3)}` : 'YTD'} breakdown</h2></div>
      <div className="category-index-list">
        {categories.map(category => {
          const expanded = !isIncome && expandedCategory === category.name;
          const subs = expanded ? subcategoryBreakdown(rows.filter(row => row.category === category.name)) : [];
          return <div key={category.name} className="category-index-group">
            <Button variant="ghost" aria-expanded={isIncome ? undefined : expanded} onClick={() => chooseGroup(category.name)} className={cn('category-index-row', selected?.name === category.name && 'category-index-row-active')}>
              <span style={{ background: category.color }}/><div className="min-w-0"><strong>{category.name}</strong><small>{money(category.value)}</small></div><em>{Math.round(category.value / (categoryTotal || 1) * 100)}%</em>
              {!isIncome && <ChevronDown className={cn('category-expand-icon', expanded && 'category-expand-icon-open')}/>}
            </Button>
            {expanded && <div className="category-subcategories">{subs.map(item => <button key={item.name} onClick={() => { setSelectedCategory(category.name); setSubcategory(current => current === item.name ? null : item.name); }} className={cn('category-subcategory w-full text-left', subcategory === item.name && 'text-brand')}><span>{item.name}</span><strong>{money(item.amount)}</strong></button>)}</div>}
          </div>;
        })}
        {categories.length === 0 && <p className="text-sm text-muted-foreground">No {analysis.toLowerCase()} in this period.</p>}
      </div>
    </aside>
    <section className="category-detail">
      <div className="category-detail-heading">
        <div><p className="eyebrow">{showAll ? `${isIncome ? incomeLabel : 'All spending categories'} over time` : `${selected?.name ?? analysis} over time`}</p><h2 className="mt-1 text-2xl font-semibold">{money(amount)} <span className={cn('category-delta', delta !== null && (isIncome ? delta >= 0 : delta <= 0) ? 'text-positive' : 'text-negative')}>{showAll || delta === null ? '' : `${delta > 0 ? '+' : ''}${delta}% vs prior`}</span></h2></div>
        <div className="flex items-center gap-2"><Button variant="glass" size="sm" onClick={() => setShowAll(current => !current)}>{showAll ? 'Single chart' : 'See all charts'}</Button><span className="category-swatch" style={{ background: selected?.color }}/></div>
      </div>
      <div className="category-trend">
        {showAll ? <ResponsiveContainer width="100%" height="100%"><BarChart data={chart.rows} onClick={chooseMonth} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}/><YAxis domain={[0, 'auto']} width={52} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} tickFormatter={axisMoney}/><Tooltip content={<ChartTip/>}/>{chart.groups.map(category => <Bar key={category.name} name={category.name} dataKey={category.name} stackId="categories" fill={category.color}/>)}
        </BarChart></ResponsiveContainer> : <ResponsiveContainer width="100%" height="100%"><LineChart data={trendData} onClick={chooseMonth} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)"/><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}/><YAxis domain={[0, 'auto']} width={52} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} tickFormatter={axisMoney}/><Tooltip content={<ChartTip/>}/><Line type="monotone" dataKey="value" name={selected?.name} stroke={selected?.color} strokeWidth={3} dot={{ r: 4, fill: selected?.color, strokeWidth: 0 }} activeDot={{ r: 7 }}/>
        </LineChart></ResponsiveContainer>}
      </div>
      <div className="category-chart-notes"><p className="text-[11px] text-muted-foreground">{isIncome ? scope === 'Shared' ? 'Joint-account funding, not personal income.' : 'Recognized income only · excludes repayments and own-account transfers.' : 'Gross spending by category · repayments offset net spend separately.'}</p>
      {showAll && <div className="chart-legend">{chart.groups.map(category => <span key={category.name}><i style={{ background: category.color }}/>{category.name}</span>)}</div>}</div>
      <div className="category-transactions">
        <div className="flex items-end justify-between gap-2"><div><p className="eyebrow">Inside {selected?.name ?? analysis}{subcategory ? ` · ${subcategory}` : ''}</p><h3 className="mt-1 text-base font-semibold">{isIncome ? 'Payments received' : 'Itemized purchases'}</h3></div><span className="text-xs text-muted-foreground">{selectedRows.length} items{subcategory && <button className="ml-2 text-brand" onClick={() => setSubcategory(null)}>Clear filter</button>}</span></div>
        <div className="mt-3 space-y-2">{selectedRows.slice(0, limit).map(row => <Button variant="ghost" className="day-transaction category-transaction-link" key={row.id} onClick={() => onTransaction(row)}>
          <span className="transaction-dot" style={{ background: selected?.color }}/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{row.merchant}</p><p className="text-[10px] text-muted-foreground">{dateLabel(row.date)} · {isIncome ? row.account : row.subcategory || row.account}</p></div><strong className={isIncome ? 'text-positive' : undefined}>{isIncome ? '+' : ''}{money(Math.abs(row.amount), 2)}</strong><ChevronRight className="size-4 shrink-0 text-muted-foreground"/>
        </Button>)}
        {selectedRows.length > limit && <Button variant="glass" size="sm" onClick={() => setLimit(current => current + 60)}>Show more</Button>}
        {selectedRows.length === 0 && <p className="text-sm text-muted-foreground">No {isIncome ? 'payments received' : 'itemized purchases'} in this selection.</p>}</div>
      </div>
    </section>
  </div>;
}

function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => { if (!open) return; const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [open, onClose]);
  return <><button aria-label={`Close ${title}`} aria-hidden={!open} inert={!open} onClick={onClose} className={cn('drawer-scrim', open && 'drawer-scrim-open')}/><aside className={cn('budget-drawer', open && 'budget-drawer-open')} aria-hidden={!open} inert={!open}><div className="flex items-center justify-between"><div><p className="eyebrow">Financial journal</p><h2 className="mt-1 text-xl font-semibold">{title}</h2></div><Button variant="icon" size="icon" onClick={onClose} aria-label="Close"><X className="size-4"/></Button></div><div className="drawer-body">{children}</div></aside></>;
}

function ForecastPanel({ model }: { model: FinanceModel }) {
  const options = model.data.settings.forecast;
  const completed = model.personal.filter(row => row.month >= (options.income_average_start_month ?? model.data.settings.analysis.start_date.slice(0,7)) && !row.partial).slice(-options.recent_months);
  const average = (field: 'income' | 'spending') => completed.length ? completed.reduce((sum, row) => sum + row[field], 0) / completed.length : 0;
  const [income, setIncome] = useState(() => average('income'));
  const [spending, setSpending] = useState(() => average('spending'));
  useEffect(() => { setIncome(average('income')); setSpending(average('spending')); }, [model.data.lastUpdatedAt]);
  const latestDate = model.data.coverage.latestDate;
  const currentMonth = latestDate.slice(0, 7), current = model.personal.find(row => row.month === currentMonth);
  const days = new Date(Date.UTC(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5)), 0)).getUTCDate();
  const remainingFraction = Math.max(0, (days - Number(latestDate.slice(8))) / days);
  let balance = model.data.baseline.balanceSgd;
  const targetMonth = options.target_month ?? `${currentMonth.slice(0,4)}-12`;
  const count = Math.max(0,(Number(targetMonth.slice(0,4))-Number(currentMonth.slice(0,4)))*12 + Number(targetMonth.slice(5))-Number(currentMonth.slice(5))+1);
  const projection = Array.from({ length: count }, (_, index) => {
    const month = new Date(Date.UTC(Number(currentMonth.slice(0,4)),Number(currentMonth.slice(5))-1+index,1)).toISOString().slice(0,7);
    const projectedIncome = index === 0 ? Math.max(0, income - (current?.income ?? 0)) : income;
    const projectedSpend = index === 0 ? spending * remainingFraction : spending;
    balance += projectedIncome - projectedSpend;
    return { month, label: monthLabel(month), balance, income: projectedIncome, spending: projectedSpend };
  });
  return <><div className="projection-card mt-5"><p className="eyebrow">Projected personal balance · {monthLabel(targetMonth, true)}</p><p className="mt-2 text-4xl font-semibold">{money(balance)}</p><p className="mt-2 text-xs text-muted-foreground">From {money(model.data.baseline.balanceSgd)} available on {dateLabel(latestDate)}</p></div><div className="mt-5 space-y-4"><label className="forecast-input"><span>Monthly net income</span><input aria-label="Forecast monthly income" type="number" min="0" step={options.slider_step} value={Math.round(income)} onChange={event => setIncome(Number(event.target.value) || 0)}/></label><label className="forecast-input"><span>Monthly net spend</span><input aria-label="Forecast monthly spending" type="number" min="0" step={options.slider_step} value={Math.round(spending)} onChange={event => setSpending(Number(event.target.value) || 0)}/></label><input aria-label="Adjust monthly spending" className="range" type="range" min="0" max={Math.max(options.slider_max, Math.ceil(spending / options.slider_step) * options.slider_step)} step={options.slider_step} value={spending} onChange={event => setSpending(Number(event.target.value))}/><Button variant="glass" size="sm" onClick={() => { setIncome(average('income')); setSpending(average('spending')); }}>Reset to recent average</Button></div><div className="forecast-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={projection} margin={{ left: 0, right: 8 }}><XAxis dataKey="label" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false}/><YAxis width={52} tickFormatter={axisMoney} tick={{ fill: 'var(--muted-foreground)', fontSize: 9 }} axisLine={false} tickLine={false}/><Tooltip content={<ChartTip/>}/><Area dataKey="balance" name="Projected balance" stroke="var(--brand)" fill="var(--brand-soft)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div><p className="text-xs leading-relaxed text-muted-foreground">Defaults use the last {options.recent_months} completed months in your configured averaging period. Current-month income already received is deducted, and only the remaining days’ spending is projected. Shared-account funds are excluded. Amount bands use the original payment before reimbursements.</p></>;
}

function SourcesPanel({ model, onRefresh }: { model: FinanceModel; onRefresh: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  return <>{error && <p role="alert" className="mt-4 text-xs text-negative">{error}</p>}<div className="mt-5 space-y-3">{model.data.accounts.map(account => <div key={account.accountId} className="account-summary"><div><strong>{account.accountName}</strong><small>{account.scope} · {account.accountId}</small></div><strong>{account.balanceSgd === null ? '—' : money(account.balanceSgd, 2)}</strong><p>{account.assumed ? 'Assumed closing balance' : account.statementDate ? `Statement ${dateLabel(account.statementDate)}` : 'Statement balance'}{account.ledgerBalanceSgd !== null && account.ledgerBalanceSgd !== undefined && account.ledgerBalanceSgd !== account.balanceSgd ? ` · ledger ${money(account.ledgerBalanceSgd, 2)}` : ''}</p></div>)}</div><div className="mt-6"><p className="eyebrow">Source gaps · {model.data.sourceGaps.length}</p><div className="mt-3 space-y-3">{model.data.sourceGaps.map((gap, index) => <div key={`${gap.accountId}-${index}`} className="source-gap"><strong>{model.data.accounts.find(account => account.accountId === gap.accountId)?.accountName ?? gap.accountId}</strong><span>{gap.startDate} → {gap.endDate}</span></div>)}{model.data.sourceGaps.length === 0 && <p className="text-xs text-positive">No gaps in the imported source coverage.</p>}</div></div><p className="mt-5 text-xs leading-relaxed text-muted-foreground">Pending PayLah spending is an estimate until the wallet statement arrives. It is replaced when detailed transactions are imported.</p><Button variant="glass" className="mt-4" disabled={refreshing} onClick={async () => { setRefreshing(true); setError(''); try { await onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Refresh failed'); } finally { setRefreshing(false); } }}><RefreshCw className={cn('size-3', refreshing && 'animate-spin')}/>{isDemoMode() ? 'Reset demo data' : 'Refresh statements'}</Button></>;
}
