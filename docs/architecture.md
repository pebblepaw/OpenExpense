# OpenExpense architecture

The same React dashboard has two strictly separated data providers.

- **Local:** the Node server parses DBS/POSB CSV/PDF, PayLah PDF, and Revolut CSV; reconciles owned-account movements; applies reusable merchant rules and manual workbook overrides; serves `/api/data`. Browser edits save to the workbook and recalculate metrics immediately.
- **Public demo:** the `demo` section of `config/defaults.yaml` generates fictional transactions from a fixed seed. A build-only YAML loader reads only that public file. It does not import private configuration or read source files. Vite embeds a literal demo flag only for `--mode demo`; all normal local builds embed a literal live flag. There is no runtime mode switch, persisted provider preference or demo fallback in the local app. Demo retags and recipient aliases live only in that browser's local storage. Reset clears those demo edits.

`config/config.yaml` is the single editable local settings file, merged over `config/defaults.yaml`. The standard YAML parser and schema validate it before the pipeline writes anything. Categories have stable IDs, editable names/aliases, colours, amount bands, match rules and subcategories. Aliases normalize merchant CSV and old workbook tags when a category is renamed. API payloads include only a whitelisted display/settings projection, never owner patterns, account configuration or source paths. Refresh reloads the YAML before rebuilding.

Food and shopping bands use recorded SGD payments before reimbursements. Income is recognized separately; peer receipts/refunds offset net personal spend, and owned-account transfers do not count as spending or income. Relationship-account contributions count once on the personal side, while shared purchases remain on the relationship side.

The master workbook retains stable transaction IDs, Transactions columns A:X, yellow manual columns Q:T, merchant and recipient directories, source coverage and monthly metrics. ExcelJS is the publicly installable workbook engine; a hidden validation sheet supplies native Excel dropdown lists. Old namespace-prefixed exports are normalized in memory on read. Writes replace the destination atomically.

Public builds go to `frontend/dist-demo`; live builds go to `frontend/dist`. The GitHub Pages workflow uploads only `dist-demo`. Never publish a live API payload or workbook—even if identifiers are removed, amounts and transaction patterns remain personal data.

## Frontend preservation

The migration reference is gaze-gold commit `184524b`. Preserve its micro-interactions; ask before changing animation behaviour or visual details. The period ruler retains the original 22px-to-48px expansion, negative offset, easing, label fade and collapse. It shows only available months, quarters or years and shrinks physically to fit the index count. Selecting a quarter/year anchors the dashboard to its latest available month. Space for expansion is reserved above the charts; the redundant metadata/status line is removed. Accounts and source gaps remain accessible through the information button.

Other CSS animation timings match the imported design. Transaction drawers render in a viewport portal to fix off-screen placement, retaining the original slide timing. The integration added real-data chart modes, filters and editable rows. A few chart hover-marker fills and category-chart cursor styles use Recharts defaults instead of gaze-gold's explicit colours; these differences have not been changed in this restoration pass.

## Release status

- Separate build-time providers: real data locally, synthetic data in the public demo; no switching UI.
- Generated banner saved in `docs/assets`; no financial records used in generation.
- Older personal notes excluded from publication; copied card/phone references in tests replaced with synthetic identifiers.
- Publish to a fresh repository with new history; keep the original private history private.

See the README for setup, privacy boundaries and supported workflows.

## Publishing from a private checkout

Commit reviewed source changes, then run `node scripts/export-public.mjs /path/to/empty-directory`.
The exporter copies an allowlist from committed HEAD, excludes personal notes and ignored files,
and runs the privacy guard. Review the exported files before publication; the guard is not a substitute
for review. Initialize a fresh repository for the first release. For later updates, copy reviewed source
into a clone of the public repository and commit there. **Never push the private repository's history
to the public remote.**
