---
name: update-personal-finances
description: Refresh this local Banking Statements dashboard when new DBS/POSB, PayLah, or Revolut exports are added.
---

# Update personal finances

Use this skill inside the repository after the user has added new statement files.

1. Inspect the new files and flag missing account/date coverage before changing classifications.
2. Inspect `master_transactions.xlsx` → `Merchant Directory` and `Recipient Directory` before refresh. Yellow merchant fields (display name, category, subcategory, confidence, source URL, notes) are durable mappings. Recipient aliases are user-provided names for phone-only PayLah transfers; never invent a name from a number.
3. Run `mise run refresh`. It rebuilds `master_transactions.xlsx`, preserving the workbook's manual category, subcategory, role, note, and reviewed merchant-directory mappings.
4. Start `mise run money` (builds `frontend/`, refreshes the workbook, hosts the API on localhost). The React views are Overview, Calendar, Categories, and Transactions; Personal/Relationship Account selects the account scope. Transactions supports durable inline tags and recipient aliases. If already running, POST `/api/refresh` or click **Refresh statements** after new source files or workbook edits; a separate CLI refresh does not update the server's in-memory report. Do not change the frontend design during a data-only refresh.
5. Treat DBS/POSB account-to-account movement, PayLah top-ups, and Revolut funding as internal until evidence says otherwise. Keep incoming peer money as a Net Personal Spend offset unless it is known income or a refund.
6. For a repeatedly occurring business that remains uncategorised, research the actual merchant, add a source URL and confidence to the Merchant Directory, then refresh. Apply only reusable evidence to the directory; an individual Transactions retag is row-specific. Keep opaque Grab/reference-only entries Uncategorized instead of guessing whether they were transport or food. Use `Transfers to People` when the recipient is identifiable as a person, and `Unclassified Transfers` for opaque payment transfers. The chart may collapse small categories into Other without changing ledger tags.
7. Verify changed parser/classifier/accounting boundaries with the relevant tests. Use `mise run test-site` for frontend/API integration changes; it edits only a temporary workbook copy. Leave subjective visual review to the user unless requested.

For the joint/relationship account (configured in `config/config.yaml`), import its statement into the same workbook but keep its purchases on the Relationship Account view. Personal-account transfers to the joint account are **personal outflows** categorised `Transfer to Relationship Account`; matching credits are joint-account contributions, not income or reimbursements. Do not also add joint purchases to Net Personal Spend. Separate identified personal funding from partner/other funding on the joint page. Preserve the joint ledger balance and available balance as distinct statement figures.

When a new CSV overlaps an old export, retain one copy of each transaction but keep genuinely repeated same-day purchases. Check the same purchase under changed descriptors (for example Claude/Anthropic) using timestamps, balance, and account evidence; never deduplicate by amount/date alone. When PayLah detail ends before the latest DBS CSV, one explicitly provisional wallet-spend row is inferred from later bank top-ups and automatically replaced as the wallet statement catches up. It is an estimate, not merchant detail.

The December forecast starts at the latest available combined **personal** balance and excludes the joint account; keep PayLah and Revolut at zero unless the user changes that assumption. For an unfinished month, project remaining spending and only expected income not yet received, then complete future months. Balance history before full statement coverage is back-calculated and labelled estimated. Pending PayLah detail has no known daily purchase dates; omit it from the calendar distribution and disclose the omitted amount.

`src/subcategories.mjs` resolves subcategories from final categories, amounts, and merchant mappings. Food: >=S$50, S$20–49.99, <S$20; Shopping: >=S$50 or <S$50. Bands use original SGD payments before reimbursements. Retain researched merchant types for other categories and preserve all manual overrides. The resolved subcategory is column X; earlier editable columns stay unchanged.

The dashboard is 2026-only. Keep source-gap warnings visible until corresponding statement data is supplied. `mise run money` hosts the single local website, and retags there save to the workbook and update both views immediately.
