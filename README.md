# OpenExpense

<p align="center">
  <img width="1600" alt="banner" src="docs/assets/openexpense-banner.png" />
</p>

<!-- <h1 align="center">MiroWorld</h1> -->

  <p align="center">
    <a href="https://pebblepaw.github.io/OpenExpense/"><img src="https://img.shields.io/badge/GitHub%20Pages-Demo-0a66c2?logo=github&logoColor=white" alt="GitHub Pages Demo" /></a>
    <a href="docs/architecture.md"><img src="https://img.shields.io/badge/Docs-Architecture-8b5cf6?style=flat-square&logo=readthedocs&logoColor=white" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a></p>


A local-first expense dashboard for DBS/POSB, PayLah and Revolut. Turn bank exports into an editable Excel ledger, reconcile account transfers, and see where your money goes.

**The hosted demo is entirely fictional.** Accounts, names, balances, earnings and transactions are generated from scratch. Retags stay in your browser. It cannot load your bank files or contact a personal-data API.

<table align="center">
  <tr>
    <td colspan="2" align="center">
      <img src="https://github.com/user-attachments/assets/dda67ebf-48e6-478d-b699-77678e62af87" width="1000"/>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="https://github.com/user-attachments/assets/f0c21e0c-f7e2-4e2e-9a18-1a395e72604e" width="500"/>
    </td>
    <td align="center">
      <img src="https://github.com/user-attachments/assets/0d7ae06a-ab13-460a-8be1-1d2e04a065bc" width="500"/>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
    </td>
  </tr>
</table>

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
2. Copy `config/defaults.yaml` to `config/config.yaml`. Set your owner-name variants, income sources, account display names, Revolut reference and optional joint-account details. The ignored local file has every editable setting in one place.
3. Create the source folders and add exports:

```bash
mkdir -p 'POSB:DBS Bank Statement' PayLah Revolut
cp config/defaults.yaml config/config.yaml
```

- **DBS/POSB:** transaction-history CSVs named `transaction_history*.csv`; PDFs supplement uncovered periods.
- **PayLah:** monthly statement PDFs, including nested folders.
- **Revolut:** detailed or consolidated CSV exports.

```bash
npm start
# Or: mise run money
```

Open [localhost:4173](http://127.0.0.1:4173). The launcher builds the interface and starts the loopback-only API. This app always uses your real local workbook. The separately built public demo always uses fictional data. Neither has a data-source toggle or fallback to the other provider.

Add later exports and click **Refresh statements** in Transactions or Accounts & coverage. To refresh without launching the site, use `npm run refresh` or `mise run refresh`. Browser retags recalculate immediately. External Excel edits are picked up on refresh.

## Customize the workflow

- `config/config.yaml`: all private/local settings—names, account aliases, categories, subcategories, amount bands, colours, income groups, source paths, transfer matching, balance assumptions and forecasting.
- `config/defaults.yaml`: the safe public defaults and fictional `demo` settings. Public frontend builds read **only** this file, never your private YAML.
- `config/merchant_rules.csv`: the shared starter classification rules.
- `config/merchant_directory.csv`: your private, Git-ignored merchant mappings. It is optional; fresh clones start without personal merchant history. The local workbook also retains its Merchant Directory.
- `skills/update-personal-finances/SKILL.md`: reusable statement-update instructions for a coding agent.

Raw exports and real configuration are ignored by Git. Manual workbook overrides win over automatic tags and remain keyed by stable transaction IDs. Ambiguous merchants are not silently guessed.

After editing local YAML, click **Refresh statements**: the API reloads settings, rebuilds the ledger and updates the charts/dropdowns without rebuilding the frontend. Keep category IDs and aliases stable when changing names. To add a category, give it a new ID, name, aliases, colour and subcategory list. Amount bands are inclusive lower bounds, in descending order ending at zero. A small override-only template is also available in `config/config.yaml.example`.

Statement parsers currently support **SGD**, not currency conversion. Locale controls display formatting only. Changes to public demo defaults require a new demo build/deployment.

## GitHub Pages

The workflow builds `frontend/dist-demo` and uploads **only** that static directory. It never runs the data pipeline. Public builds are locked to demo mode; the local build goes to a different directory.

For your fork, enable **Settings → Pages → GitHub Actions** and update the workflow's deployment repository condition. Relative asset URLs support project Pages paths.

## Privacy and limitations

The Node API runs only on `127.0.0.1`. Personal processing and workbook saves stay local; there is no transaction-upload service. The interface downloads Google Fonts, so it is not fully offline. Do not expose the local API publicly.

Ignored files can still be added with `git add -f`; check staged changes before sharing. Personal merchant directories are excluded from exports and rejected by the public privacy guard. Removing a previously tracked directory does not remove older Git history. The public release starts with fresh history, synthetic tests and no bank statements, workbook, personal notes or account credentials.

Statement formats can change. Review source gaps, unclassified transfers and uncertain merchant matches. Historical wallet balances currently assume zero closing PayLah/Revolut balances; incomplete balance history is labelled estimated. Forecasts are scenarios, not guarantees.

## Development

`npm test` runs the unit/pipeline suite. `npm run build:demo` builds the static demo. `npm run test:demo` checks synthetic-only browser behaviour after installing Playwright's browser with `npx playwright install chromium`.

Built with React, Vite, Recharts, Node.js and ExcelJS. Frontend adapted from [Gaze Gold](https://github.com/pebblepaw/gaze-gold). [MIT licensed](LICENSE).
