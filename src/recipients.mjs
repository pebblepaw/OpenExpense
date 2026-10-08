export function recipientNumberFor(transaction) {
  if (transaction.source !== 'paylah-pdf' || !['transfer_to_person', 'peer_receipt'].includes(transaction.role)) return null;
  const match = String(transaction.descriptionRaw ?? '').match(/^(?:SEND MONEY TO|RECEIVE MONEY FROM)\s+(?:\+?65[ -]?)?(\d{8})\b/i);
  return match?.[1] ?? null;
}

export function withRecipientDisplay(transaction, aliases = new Map()) {
  const recipientNumber = recipientNumberFor(transaction);
  if (!recipientNumber) return transaction;
  return {
    ...transaction,
    recipientNumber,
    recipientDisplayName: aliases.get(recipientNumber) ?? null
  };
}
