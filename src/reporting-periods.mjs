// A period selection uses its latest available month as the existing dashboard anchor.
export function reportingPeriodIndices(keys, period) {
  const groups = new Map();
  const months = [...new Set(keys)].sort();
  const multipleYears = new Set(months.map(month => month.slice(0,4))).size > 1;
  for (const month of months) {
    const year = month.slice(0,4);
    const quarter = Math.ceil(Number(month.slice(5,7)) / 3);
    const id = period === 'Year' ? year : period === 'Quarter' ? `${year}-Q${quarter}` : month;
    const label = period === 'Year' ? year : period === 'Quarter' ? `Q${quarter}${multipleYears ? ` ${year}` : ''}` : month;
    const group = groups.get(id) ?? {id, label, month, months:[]};
    group.month = month;
    group.months.push(month);
    groups.set(id,group);
  }
  return [...groups.values()];
}
