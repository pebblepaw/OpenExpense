import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dateLabel, money, monthLabel, expenseRows, type AccountScope, type CategoryInfo, type Transaction } from "@/lib/finance-data";
import { cn } from "@/lib/utils";

export type CalendarViewProps = {
  rows: Transaction[]; scope: AccountScope; month: string; monthKeys: string[]; categories: CategoryInfo[];
  onMonthChange: (month: string) => void; onTransaction: (row: Transaction) => void;
};

type DaySpend = { amount: number; categories: { name: string; amount: number }[]; rows: Transaction[] };

export function CalendarView({ rows, scope, month, monthKeys, categories, onMonthChange, onTransaction }: CalendarViewProps) {
  const [category, setCategory] = useState("All");
  const provisionalRows = useMemo(() => expenseRows(rows, scope, [month]).filter(row => row.provisional), [rows, scope, month]);
  const omittedPending = provisionalRows.filter(row => category === "All" || row.category === category).reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const daily = useMemo(() => {
    const grouped = new Map<string, DaySpend>();
    for (const row of expenseRows(rows, scope, [month]).filter(row => !row.provisional)) {
      const entry = grouped.get(row.date) ?? { amount: 0, categories: [], rows: [] };
      const amount = Math.abs(row.amount);
      entry.amount += amount;
      entry.rows.push(row);
      const name = row.category;
      const bucket = entry.categories.find(item => item.name === name);
      if (bucket) bucket.amount += amount;
      else entry.categories.push({ name, amount });
      grouped.set(row.date, entry);
    }
    return grouped;
  }, [rows, scope, month]);
  const filteredDaily = useMemo(() => {
    if (category === "All") return daily;
    const result = new Map<string, DaySpend>();
    for (const [date, entry] of daily) {
      const matching = entry.rows.filter(row => row.category === category);
      if (!matching.length) continue;
      const rowsByCategory = new Map<string, number>();
      for (const row of matching) rowsByCategory.set(row.category, (rowsByCategory.get(row.category) ?? 0) + Math.abs(row.amount));
      result.set(date, { amount: matching.reduce((sum, row) => sum + Math.abs(row.amount), 0), categories: [...rowsByCategory].map(([name, amount]) => ({ name, amount })), rows: matching });
    }
    return result;
  }, [daily, category]);
  const [selectedDate, setSelectedDate] = useState(`${month}-01`);
  useEffect(() => {
    const dates = [...daily.keys()].sort();
    setSelectedDate(dates.at(-1) ?? `${month}-01`);
  }, [month, daily]);
  const date = new Date(`${month}-01T00:00:00Z`);
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const selected = filteredDaily.get(selectedDate);
  const max = Math.max(1, ...[...filteredDaily.values()].map(item => item.amount));
  const monthPosition = monthKeys.indexOf(month);

  function stepMonth(step: number) {
    const next = monthKeys[monthPosition + step];
    if (next) onMonthChange(next);
  }

  function pieStyle(spend: DaySpend) {
    let offset = 0;
    const segments = spend.categories.map(item => {
      const start = offset;
      offset += item.amount / spend.amount * 100;
      const color = categories.find(candidate => candidate.name === item.name)?.color ?? "var(--chart-muted)";
      return `${color} ${start}% ${offset}%`;
    });
    return `conic-gradient(from 0deg at 50% 50%, ${segments.join(", ")})`;
  }

  return <div className="calendar-layout animate-view">
    <section className="calendar-panel">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Spending calendar · Monthly</p><h2 className="mt-1 text-xl font-semibold">{monthLabel(month, true)}</h2></div><div className="flex items-center gap-2"><label className="filter-select"><span className="sr-only">Filter category</span><select value={category} onChange={event => setCategory(event.target.value)}><option>All</option>{categories.map(item => <option key={item.name}>{item.name}</option>)}</select></label><button type="button" className="rounded-lg p-2 hover:bg-accent" aria-label="Previous month" disabled={monthPosition <= 0} onClick={() => stepMonth(-1)}><ChevronLeft className="size-4"/></button><button type="button" className="rounded-lg p-2 hover:bg-accent" aria-label="Next month" disabled={monthPosition < 0 || monthPosition >= monthKeys.length - 1} onClick={() => stepMonth(1)}><ChevronRight className="size-4"/></button></div></div>
      <div className="calendar-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{Array.from({ length: cellCount }, (_, index) => {
        const day = index - mondayOffset + 1;
        if (day < 1 || day > daysInMonth) return <span key={`empty-${index}`} className="calendar-empty"/>;
        const dayKey = `${month}-${String(day).padStart(2, "0")}`;
        const spend = filteredDaily.get(dayKey);
        const intensity = spend ? Math.max(.12, spend.amount / max) : 0;
        const size = spend ? 27 + intensity * 31 : 0;
        return <button type="button" key={dayKey} onClick={() => setSelectedDate(dayKey)} className={cn("calendar-day", selectedDate === dayKey && "calendar-day-active")} aria-pressed={selectedDate === dayKey}>
          <span className="day-number">{day}</span>{spend && <><span className="spending-pie-shell" style={{ width: `${size}px`, height: `${size}px` }}><span className="spending-pie" style={{ background: pieStyle(spend) }}/></span><small>{money(spend.amount)}</small></>}
        </button>;
      })}</div>
      <div className="calendar-legend"><span>Circle size shows daily spend</span><span className="legend-pie"/><b>Colour shows category mix</b></div>
    </section>
    <aside className="day-panel">
      <div className="day-heading"><div><p className="eyebrow">Selected day</p><p className="mt-1 text-3xl font-semibold">{dateLabel(selectedDate)}</p></div><strong>{money(selected?.amount ?? 0)}</strong></div>
      {omittedPending > 0 && <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">Omitted provisional PayLah amount: {money(omittedPending)}. This pending total has no known daily dates, so it is excluded from the calendar instead of being distributed.</p>}
      <div className="day-breakdown"><p className="eyebrow">Category breakdown</p><div className="mt-3 space-y-3">{selected?.categories.map(item => { const color = categories.find(candidate => candidate.name === item.name)?.color ?? "var(--chart-muted)"; return <div className="day-category" key={item.name}><span style={{ background: color }}/><div><strong>{item.name}</strong><i style={{ width: `${item.amount / (selected.amount || 1) * 100}%`, background: color }}/></div><em>{money(item.amount)}</em></div>; }) ?? <p className="text-sm text-muted-foreground">No spending recorded.</p>}</div></div>
      <div className="day-activity"><p className="eyebrow">Purchases · {selected?.rows.length ?? 0}</p><div className="mt-3 space-y-2">{selected?.rows.map(row => <button type="button" className="day-transaction w-full text-left transition-colors hover:border-[var(--border-strong)]" key={row.id} onClick={() => onTransaction(row)}><span className="transaction-dot"/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{row.merchant}</span><span className="block truncate text-[10px] text-muted-foreground">{row.detail}</span></span><strong className="text-sm">{money(Math.abs(row.amount), 2)}</strong></button>)}{!selected?.rows.length && <p className="text-sm text-muted-foreground">No itemized purchases on this day.</p>}</div></div>
    </aside>
  </div>;
}
