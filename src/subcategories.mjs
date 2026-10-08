export const categorySubcategories = {
  'Food & Dining': ['Really big meals ($50+)', 'Big meals ($20–$49.99)', 'Other meals (<$20)'],
  Groceries: ['Supermarket', 'Specialty grocery', 'Produce', 'Convenience store', 'Bread'],
  Transport: ['Public Transport', 'Ride Hailing', 'Bike sharing', 'Transit', 'Ride-hailing'],
  Shopping: ['Big purchases ($50+)', 'Other purchases (<$50)'],
  Entertainment: ['Digital books', 'Subscription', 'Apps and subscriptions', 'Cinema', 'Music subscription', 'Comedy show'],
  Travel: ['Booking', 'Airfare', 'Lodging', 'Activities'],
  Bills: ['Mobile Plan', 'Cloud Subscription', 'Streaming Subscription', 'Software Subscription', 'Software subscription', 'Mobile', 'Insurance', 'Internet'],
  Gym: ['Fitness & Supplements', 'Fitness membership'],
  'Education & Work': ['Digital services', 'Cloud hosting', 'Software subscription', 'Professional subscription', 'Campus supplies', 'Campus services'],
  Healthcare: ['Medical', 'Mental health'],
  Cash: ['Cash withdrawal'],
  'Transfer to Relationship Account': ['Relationship transfer'],
  'Transfers to People': ['Person transfer'],
  'Unclassified Transfers': ['Unclassified transfer'],
  'Pending PayLah detail': ['Pending detail'],
  Fees: ['Bank fee'],
  Uncategorized: ['Other']
};

const transportTransitPattern = /\b(?:MRT|SMRT|BUS|PUBLIC TRANSPORT|EZ.?LINK|SIMPLYGO)\b/i;
const transportRidePattern = /\b(?:RIDE.?HAIL|TAXI|GOJEK|RYDE|UBER)\b/i;

/** @param {{category?: string | null, amountSgd?: number, description?: string, suggestedSubcategory?: string | null, role?: string}} [options] */
export function resolveAutomaticSubcategory({ category, amountSgd, description = '', suggestedSubcategory = null, role = 'expense' } = {}) {
  if (['income', 'refund', 'internal_transfer', 'peer_receipt', 'relationship_contribution'].includes(role)) return null;
  const amount = Math.abs(Number(amountSgd));
  if (category === 'Food & Dining' && Number.isFinite(amount)) {
    if (amount >= 50) return 'Really big meals ($50+)';
    if (amount >= 20) return 'Big meals ($20–$49.99)';
    return 'Other meals (<$20)';
  }
  if (category === 'Shopping' && Number.isFinite(amount)) return amount >= 50 ? 'Big purchases ($50+)' : 'Other purchases (<$50)';
  if (category === 'Transport' && !suggestedSubcategory) {
    if (transportTransitPattern.test(description)) return 'Transit';
    if (transportRidePattern.test(description)) return 'Ride Hailing';
  }
  return suggestedSubcategory ?? ({ 'Transfer to Relationship Account': 'Relationship transfer', 'Transfers to People': 'Person transfer', 'Unclassified Transfers': 'Unclassified transfer', 'Pending PayLah detail': 'Pending detail', Cash: 'Cash withdrawal', Fees: 'Bank fee' }[category] ?? null);
}
