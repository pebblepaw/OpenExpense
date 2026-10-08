/** @param {{category?: string | null, amountSgd?: number, description?: string, suggestedSubcategory?: string | null, role?: string, definitions?: Record<string, any>}} [options] */
export function resolveAutomaticSubcategory({ category, amountSgd, description = '', suggestedSubcategory = null, role = 'expense', definitions = {} } = {}) {
  if (['income', 'refund', 'internal_transfer', 'peer_receipt', 'relationship_contribution'].includes(role)) return null;
  const definition = Object.values(definitions).find(entry => entry.name === category || (entry.aliases ?? []).includes(category));
  const amount = Math.abs(Number(amountSgd));
  if (definition?.amount_bands?.length && Number.isFinite(amount)) return definition.amount_bands.find(band => amount >= band.min)?.name ?? null;
  if (suggestedSubcategory) return suggestedSubcategory;
  const rule = definition?.match_rules?.find(rule => new RegExp(rule.pattern,'i').test(description));
  return rule?.name ?? definition?.default_subcategory ?? null;
}
