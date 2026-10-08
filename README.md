![OpenExpense — Your money. Your data. Your rules.](docs/assets/openexpense-banner.png)

# OpenExpense

A local-first expense dashboard for DBS/POSB, PayLah and Revolut. Turn bank exports into an editable Excel ledger, reconcile account transfers, and see where your money goes.

[Try the live demo](https://pebblepaw.github.io/OpenExpense/) · [Source code](https://github.com/pebblepaw/OpenExpense) · [How it works](docs/architecture.md)

**The hosted demo is entirely fictional.** Accounts, names, balances, earnings and transactions are generated from scratch. Retags stay in your browser. It cannot load your bank files or contact a personal-data API.

## What you get

- Monthly income, net spending, savings and combined balance history.
- Category/subcategory trends, a daily spending calendar, filters and transaction drilldowns.
- Inline retagging, notes and recipient aliases that survive local statement refreshes.
- An optional relationship account: contributions count once in personal spending; shared purchases stay separate.
- Reusable merchant mappings, source-gap warnings and a December savings estimator.
- A master workbook with an editable ledger, merchant directory, recipient directory and monthly metrics.

**Net personal spend = eligible outflows − peer repayments/refunds.** Owned-account movements are excluded. Category charts show gross purchases, with repayment offsets separate. Food/shopping size bands describe the original payment, not one person's share.

## Try it without bank data

Requires **Node.js 22.12+** and npm. No Codex, API key or bank connection required.

```bash
git clone https://github.com/pebblepaw/OpenExpense.git
cd OpenExpense
npm ci
npm ci --prefix frontend
npm run demo
```

Open [localhost:4174](http://127.0.0.1:4174). Or use `mise run demo` if [mise](https://mise.jdx.dev/) is installed. Both run a synthetic-only site.

## Use your own statements locally

1. Install [Poppler](https://poppler.freedesktop.org/) for PDF parsing: `brew install poppler` on macOS, or `sudo apt install poppler-utils` on Ubuntu.
2. Copy `config/config.yaml.example` to `config/config.yaml`. Set your owner-name variants, income sources, Revolut reference and optional joint-account details.
3. Create the source folders and add exports:

```bash
mkdir -p 'POSB:DBS Bank Statement' PayLah Revolut
cp config/config.yaml.example config/config.yaml
```

- **DBS/POSB:** transaction-history CSVs named `transaction_history*.csv`; PDFs supplement uncovered periods.
- **PayLah:** monthly statement PDFs, including nested folders.
- **Revolut:** detailed or consolidated CSV exports.

```bash
npm start
# Or: mise run money
```

Open [localhost:4173](http://127.0.0.1:4173). The launcher builds the interface, refreshes the workbook and starts the loopback-only API. **My data / Demo** switches providers locally; demo edits never touch your workbook.

Add later exports and click **Refresh statements** in Transactions or Accounts & coverage. To refresh without launching the site, use `npm run refresh` or `mise run refresh`. Browser retags recalculate immediately. External Excel edits are picked up on refresh.

## Customize the workflow

- `config/config.yaml`: private account details, source folders and income recognition.
- `config/income_sources.json` + private YAML `income_sources`: income display groups.
- `config/categories.json`: canonical categories.
- `config/merchant_rules.csv` and `config/merchant_directory.csv`: reusable classifications.
- `config/demo.json`: fictional demo parameters and merchants.
- `skills/update-personal-finances/SKILL.md`: reusable statement-update instructions for a coding agent.

Raw exports and real configuration are ignored by Git. Manual workbook overrides win over automatic tags and remain keyed by stable transaction IDs. Ambiguous merchants are not silently guessed.

## GitHub Pages

The workflow builds `frontend/dist-demo` and uploads **only** that static directory. It never runs the data pipeline. Public builds are locked to demo mode; the local build goes to a different directory.

For your fork, enable **Settings → Pages → GitHub Actions** and update the workflow's deployment repository condition. Relative asset URLs support project Pages paths.

## Privacy and limitations

The Node API runs only on `127.0.0.1`. Personal processing and workbook saves stay local; there is no transaction-upload service. The interface downloads Google Fonts, so it is not fully offline. Do not expose the local API publicly.

Ignored files can still be added with `git add -f`; check staged changes before sharing. The public release starts with fresh history, synthetic tests and no bank statements, workbook, personal notes or account credentials.

Statement formats can change. Review source gaps, unclassified transfers and uncertain merchant matches. Historical wallet balances currently assume zero closing PayLah/Revolut balances; incomplete balance history is labelled estimated. Forecasts are scenarios, not guarantees.

## Development

`npm test` runs the unit/pipeline suite. `npm run build:demo` builds the static demo. `npm run test:demo` checks synthetic-only browser behaviour after installing Playwright's browser with `npx playwright install chromium`.

Built with React, Vite, Recharts, Node.js and ExcelJS. Frontend adapted from [Gaze Gold](https://github.com/pebblepaw/gaze-gold). [MIT licensed](LICENSE).
