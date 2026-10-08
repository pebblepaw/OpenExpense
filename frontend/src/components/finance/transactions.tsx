import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, ChevronDown, Download, Filter, ListFilter, MoreHorizontal, Plus, Search, WalletCards, X } from "lucide-react";
import { dateLabel, isDemoMode, money, monthLabel, type AccountScope, type Period, type Transaction, type TransactionPatch } from "@/lib/finance-data";
import { cn } from "@/lib/utils";

export type TransactionsViewProps = {
  rows: Transaction[]; scope: AccountScope; month: string; period: Period; monthKeys: string[]; activeKeys: string[];
  focusedTransaction: Transaction | null; categories: string[]; subcategories: Record<string, string[]>;
  onSave: (id: string, patch: TransactionPatch) => Promise<void>;
  onRecipientAlias: (number: string, name: string) => Promise<void>;
  onRefresh: () => Promise<void>;
};

const types = ["All", "Expense", "Income", "Receipt", "Internal transfer", "Contribution"] as const;
const roleOptions = ["expense", "income", "refund", "peer_receipt", "internal_transfer", "transfer_to_person", "relationship_contribution", "relationship_transfer", "paylah_pending_wallet"];

export function TransactionsView(props: TransactionsViewProps) {
  const { rows, scope, month, monthKeys, activeKeys, focusedTransaction, categories, subcategories, onSave, onRecipientAlias, onRefresh } = props;
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>(focusedTransaction ? "All" : "Expense");
  const [category, setCategory] = useState(focusedTransaction?.category ?? "All");
  const [subcategory, setSubcategory] = useState("All");
  const [dateRange, setDateRange] = useState(focusedTransaction?.date ?? "Period");
  const [sort, setSort] = useState("Newest");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreId, setMoreId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [limit, setLimit] = useState(100);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [alias, setAlias] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const more = rows.find(row => row.id === moreId) ?? null;
  const availableAccounts = useMemo(() => [...new Set(rows.filter(row => row.scope === scope).map(row => row.account))].sort(), [rows, scope]);
  const focusId = focusedTransaction?.id;
  const filtered = useMemo(() => rows.filter(row => {
    const dateMatch = dateRange === "All time" ? true : dateRange === "Period" ? activeKeys.includes(row.date.slice(0, 7)) : dateRange.length === 10 ? row.date === dateRange : row.date.startsWith(dateRange);
    const query = `${row.merchant} ${row.detail} ${row.account} ${row.category} ${row.subcategory ?? ""}`.toLowerCase();
    return row.scope === scope && dateMatch && (!accounts.length || accounts.includes(row.account)) && (type === "All" || row.type === type) && (category === "All" || row.category === category) && (subcategory === "All" || row.subcategory === subcategory) && query.includes(search.trim().toLowerCase());
  }).sort((a, b) => {
    if (a.id === focusId) return -1;
    if (b.id === focusId) return 1;
    if (sort === "Highest") return Math.abs(b.amount) - Math.abs(a.amount);
    if (sort === "Lowest") return Math.abs(a.amount) - Math.abs(b.amount);
    const delta = a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    return sort === "Oldest" ? delta : -delta;
  }), [rows, scope, dateRange, activeKeys.join("|"), accounts, type, category, subcategory, search, sort, focusId]);
  const pageRows = filtered.slice(0, limit);
  const total = filtered.reduce((sum, row) => sum + row.amount, 0);

  useEffect(() => {
    if (!focusId) return;
    const target = document.getElementById(`transaction-${focusId}`);
    target?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [focusId, limit, pageRows.length]);
  useEffect(() => setLimit(100), [scope, dateRange, type, category, subcategory, search, sort, accounts]);
  useEffect(() => { setSubcategory("All"); }, [category]);
  useEffect(() => { setAccounts([]); }, [scope]);

  async function save(id: string, patch: TransactionPatch) {
    setSaving(id); setError("");
    try { await onSave(id, patch); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this transaction."); }
    finally { setSaving(null); }
  }
  function exportCsv() {
    const header = ["id", "date", "merchant", "description", "account", "category", "subcategory", "type", "amount_sgd", "source", "source_file"];
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const content = [header, ...filtered.map(row => [row.id, row.date, row.merchant, row.detail, row.account, row.category, row.subcategory, row.type, row.amount.toFixed(2), row.source, row.sourceFile])].map(line => line.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `transactions-${scope.toLowerCase()}-${month}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  const editable = (row: Transaction) => !row.provisional && (row.role !== "internal_transfer" || row.manualRole === "internal_transfer");
  async function refresh() {
    setRefreshing(true); setError("");
    try { await onRefresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not refresh statements."); }
    finally { setRefreshing(false); }
  }

  return <div className="transactions-panel animate-view">
    <div className="transaction-heading"><div><p className="eyebrow">All activity · {scope}</p><h2 className="mt-1 text-xl font-semibold">Transactions</h2></div><div className="flex gap-2"><button type="button" className="filter-select" onClick={exportCsv}><Download className="size-3.5"/>Export CSV</button><button type="button" className="filter-select" onClick={() => setImportOpen(true)}><Plus className="size-3.5"/>Import statement</button></div></div>
    <div className="filterbar"><label className="search-box"><Search className="size-4"/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search transactions"/></label>
      <FilterSelect icon={<ListFilter className="size-3.5"/>} value={type} onChange={setType} options={[...types]}/>
      <FilterSelect icon={<Filter className="size-3.5"/>} value={category} onChange={setCategory} options={["All", ...new Set([...categories, "Income", "Internal transfer", "Contribution"])]}/>
      {category !== "All" && (subcategories[category]?.length ?? 0) > 0 && <FilterSelect icon={<Filter className="size-3.5"/>} value={subcategory} onChange={setSubcategory} options={["All", ...subcategories[category]]}/>}
      <div className="account-filter"><button type="button" className="filter-select" aria-expanded={accountOpen} onClick={() => setAccountOpen(open => !open)}><WalletCards className="size-3.5"/>{accounts.length ? `${accounts.length} accounts` : "All accounts"}<ChevronDown className="size-3"/></button>{accountOpen && <div className="account-menu">{availableAccounts.map(account => <button type="button" key={account} onClick={() => setAccounts(current => current.includes(account) ? current.filter(item => item !== account) : [...current, account])}><span className={cn("account-check", accounts.includes(account) && "account-check-active")}>{accounts.includes(account) && <Check className="size-3"/>}</span>{account}</button>)}</div>}</div>
      <FilterSelect icon={<CalendarDays className="size-3.5"/>} value={dateRange} onChange={setDateRange} options={["Period", "All time", ...monthKeys, ...new Set([focusedTransaction?.date].filter((value): value is string => Boolean(value)))]} labels={["Period", "All time", ...monthKeys.map(key => monthLabel(key, true)), ...(focusedTransaction ? [dateLabel(focusedTransaction.date)] : [])]}/>
      <FilterSelect icon={<ChevronDown className="size-3.5"/>} value={sort} onChange={setSort} options={["Newest", "Oldest", "Highest", "Lowest"]}/>
    </div>
    {error && <p role="alert" className="mb-2 text-xs text-negative">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>Date</th><th>Merchant</th><th>Account</th><th>Category · subcategory</th><th className="text-right">Amount</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{pageRows.map(row => { const canEdit = editable(row); const subOptions = subcategories[row.category] ?? []; return <tr key={row.id} id={`transaction-${row.id}`} className={cn(row.id === focusId && "transaction-row-focused")}>
      <td className="whitespace-nowrap text-muted-foreground">{row.date}</td><td><div className="font-medium">{row.merchant}</div><div className="text-[10px] text-muted-foreground">{row.detail}</div>{row.provisional && <small className="text-amber-500">Provisional · estimated source</small>}</td><td><span className="account-chip">{row.account}</span></td>
      <td>{canEdit ? <div className="flex flex-col gap-1"><select aria-label={`Category for ${row.merchant}`} disabled={saving === row.id} value={row.manualCategory ?? row.category} onChange={event => void save(row.id, { manualCategory: event.target.value, manualSubcategory: null })}>{[...new Set([row.category, ...categories])].map(item => <option key={item}>{item}</option>)}</select><select aria-label={`Subcategory for ${row.merchant}`} disabled={saving === row.id} value={row.manualSubcategory ?? ""} onChange={event => void save(row.id, { manualSubcategory: event.target.value || null })}><option value="">Automatic · {row.subcategory ?? "None"}</option>{[...new Set([...subOptions, ...(row.subcategory ? [row.subcategory] : [])])].map(item => <option key={item}>{item}</option>)}</select></div> : <span>{row.category}{row.subcategory ? ` · ${row.subcategory}` : ""}</span>}{saving === row.id && <small className="text-muted-foreground">Saving…</small>}</td>
      <td className={cn("min-w-36 whitespace-nowrap text-right font-semibold", row.amount > 0 ? "text-positive" : "text-foreground")}>{row.amount > 0 ? "+" : "−"}{money(Math.abs(row.amount), 2)}</td><td><button type="button" className="rounded-lg p-2 hover:bg-accent" aria-label={`More details for ${row.merchant}`} onClick={() => { setMoreId(row.id); setAlias(row.recipientDisplayName ?? ""); }}><MoreHorizontal className="size-4"/></button></td>
    </tr>; })}</tbody></table>{filtered.length === 0 && <div className="grid h-40 place-content-center text-sm text-muted-foreground">No transactions match these filters.</div>}</div>
    <div className="table-footer"><span>{filtered.length} transactions · {scope} · net {money(total, 2)}</span><span>Showing {pageRows.length} of {filtered.length} · amounts in SGD</span></div>
    {filtered.length > limit && <button type="button" className="filter-select mt-2 self-center" onClick={() => setLimit(value => value + 100)}>Show 100 more</button>}
    <Drawer open={Boolean(more)} close={() => setMoreId(null)} title="More details">{more && <TransactionDetails row={more} categories={categories} subcategories={subcategories} saving={saving === more.id} onSave={patch => void save(more.id, patch)} alias={alias} setAlias={setAlias} onAlias={async () => { if (!more.recipientNumber) return; setAliasSaving(true); setError(""); try { await onRecipientAlias(more.recipientNumber, alias.trim()); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save recipient name."); } finally { setAliasSaving(false); } }} aliasSaving={aliasSaving}/>}</Drawer>
    <Drawer open={importOpen} close={() => setImportOpen(false)} title={isDemoMode() ? "Synthetic demo" : "Import a statement"}><p className="mt-4 text-sm leading-relaxed text-muted-foreground">{isDemoMode() ? 'All accounts and transactions here are fictional. Edits stay in this browser. To import your own statements, run OpenExpense locally. Reset clears only demo edits.' : 'Add statement files to the matching existing DBS/POSB, PayLah, or Revolut source folders, then refresh statements here.'}</p><button type="button" className="filter-select mt-4" disabled={refreshing} onClick={() => void refresh()}><Download className="size-3.5"/>{refreshing ? "Refreshing…" : isDemoMode() ? "Reset demo data" : "Refresh statements"}</button>{error && <p role="alert" className="mt-3 text-xs text-negative">{error}</p>}</Drawer>
  </div>;
}

function FilterSelect({ icon, value, onChange, options, labels }: { icon: ReactNode; value: string; onChange: (value: string) => void; options: string[]; labels?: string[] }) {
  return <label className="filter-select">{icon}<select value={value} onChange={event => onChange(event.target.value)}>{options.map((option, index) => <option key={`${option}-${index}`} value={option}>{labels?.[index] ?? option}</option>)}</select><ChevronDown className="size-3"/></label>;
}

function Drawer({ open, close, title, children }: { open: boolean; close: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);
  return createPortal(<div className="transaction-drawer-layer"><button type="button" aria-label="Close details" aria-hidden={!open} inert={!open} onClick={close} className={cn("drawer-scrim", open && "drawer-scrim-open")}/><aside className={cn("budget-drawer", open && "budget-drawer-open")} aria-hidden={!open} inert={!open}><div className="flex items-center justify-between"><div><p className="eyebrow">Transaction</p><h2 className="mt-1 text-xl font-semibold">{title}</h2></div><button type="button" className="rounded-lg p-2 hover:bg-accent" onClick={close} aria-label="Close"><X className="size-4"/></button></div>{children}</aside></div>, document.body);
}

function TransactionDetails({ row, categories, subcategories, saving, onSave, alias, setAlias, onAlias, aliasSaving }: { row: Transaction; categories: string[]; subcategories: Record<string,string[]>; saving: boolean; onSave: (patch: TransactionPatch) => void; alias: string; setAlias: (value: string) => void; onAlias: () => void; aliasSaving: boolean }) {
  const locked = row.provisional || (row.role === "internal_transfer" && row.manualRole !== "internal_transfer");
  return <div className="mt-5 space-y-5 overflow-y-auto"><div><p className="font-medium">{row.merchant}</p><p className="mt-1 text-xs text-muted-foreground">{row.date} · {row.account} · {row.type}</p><p className="mt-2 text-xl font-semibold">{money(row.amount, 2)}</p></div>
    {locked && <p className="rounded-xl border border-border p-3 text-xs text-muted-foreground">{row.provisional ? "Automatically derived provisional row; edits are unavailable." : "Reconciled internal transfer; edits are protected."}</p>}
    {!locked && <><label className="block text-xs">Role<select className="mt-2 w-full rounded-lg bg-accent p-2" disabled={saving} value={row.manualRole ?? row.role} onChange={event => onSave({ manualRole: event.target.value })}>{[...new Set([...roleOptions, row.role])].map(role => <option key={role}>{role}</option>)}</select></label><label className="block text-xs">Category<select className="mt-2 w-full rounded-lg bg-accent p-2" disabled={saving} value={row.manualCategory ?? row.category} onChange={event => onSave({ manualCategory: event.target.value, manualSubcategory: null })}>{[...new Set([row.category, ...categories])].map(name => <option key={name}>{name}</option>)}</select></label><label className="block text-xs">Subcategory<select className="mt-2 w-full rounded-lg bg-accent p-2" disabled={saving} value={row.manualSubcategory ?? ""} onChange={event => onSave({ manualSubcategory: event.target.value || null })}><option value="">Automatic · {row.subcategory ?? "None"}</option>{[...new Set([...(subcategories[row.category] ?? []), ...(row.subcategory ? [row.subcategory] : [])])].map(item => <option key={item}>{item}</option>)}</select></label><button type="button" disabled={saving} className="filter-select" onClick={() => onSave({ manualCategory: null, manualSubcategory: null, manualRole: null, reviewNote: null })}>Reset to automatic</button><label className="block text-xs">Review note<textarea className="mt-2 min-h-24 w-full rounded-lg bg-accent p-3" defaultValue={row.reviewNote ?? ""} onBlur={event => { const next = event.currentTarget.value || null; if (next !== row.reviewNote) onSave({ reviewNote: next }); }}/></label></>}
    {row.recipientNumber && <div className="space-y-2 border-t border-border pt-4"><p className="eyebrow">Recipient alias</p><p className="text-xs text-muted-foreground">{row.recipientNumber}</p><div className="flex gap-2"><input className="min-w-0 flex-1 rounded-lg bg-accent p-2 text-sm" value={alias} onChange={event => setAlias(event.target.value)} placeholder="Recipient name"/><button className="filter-select" type="button" disabled={aliasSaving} onClick={onAlias}>{aliasSaving ? "Saving…" : alias.trim() ? "Save" : "Clear"}</button></div></div>}
    <div className="border-t border-border pt-4"><p className="eyebrow">Original description</p><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">{row.detail || "No description"}</p><p className="mt-3 text-[10px] text-muted-foreground">Source: {row.source}{row.provisional ? " · provisional derived row" : ""}<br/>File: {row.sourceFile || "Not recorded"}</p></div>
  </div>;
}
