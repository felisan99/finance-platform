<div align="center">

# Portfolio Tracker

**A personal investment tracker for stocks, ETFs and crypto. Every number is derived from a ledger of transactions with exact decimal math, returns are measured time- and money-weighted against a benchmark, and it runs at zero cost. It installs on the iPhone as an app and comes with a home-screen widget.**

[![CI](https://github.com/felisan99/finance-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/felisan99/finance-platform/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ECF8E?logo=supabase&logoColor=white)
![Tests](https://img.shields.io/badge/tests-1779%20unit-2EA44F?logo=vitest&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">
  <img src="docs/images/hero.png" alt="Asset detail, home dashboard and positions screens of the app on a phone" width="100%">
</picture>

<sub>Screenshots from a demo account. The interface is in Spanish because it was built for users in Uruguay.</sub>

</div>

## At a glance

- **Source of truth:** one ledger of transactions per account. Positions, cash, gains and returns are recomputed from it, never stored.
- **Calculation engine:** pure TypeScript (`lib/engine`) with no database, network or clock: average cost, splits, cash, daily value series, TWR, XIRR, drawdown, volatility and what-if analysis.
- **Money:** `decimal.js` end to end. Postgres `numeric` values are read as text, so no amount ever passes through a float.
- **Tests:** 1,779 unit tests in CI, including property-based tests with fast-check, plus integration tests for row-level security and live tests against real market data.
- **Running cost:** US$ 0 per month: Vercel Hobby, Supabase Free and Yahoo Finance, with one daily cron.
- **Access:** invite-only sign-in with 6-digit email codes. No passwords anywhere.

## Features

<table>
<tr>
<td width="50%" valign="top">

**Performance against a benchmark.** Cumulative gain, portfolio value and a normalized comparison with the S&P 500 (or Bitcoin for a crypto portfolio), from one week to all time. Shows the time-weighted return (TWR), the money-weighted return (XIRR) and the difference in percentage points.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/perf-dark.png">
  <img src="docs/images/perf.png" alt="Performance card comparing the portfolio with the S&P 500">
</picture>

</td>
<td width="50%" valign="top">

**Monthly returns.** Each calendar month of the portfolio next to the benchmark with dividends reinvested. The first and current months are partial, and the card says so.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/monthly-dark.png">
  <img src="docs/images/monthly.png" alt="Monthly returns bar chart against the S&P 500">
</picture>

**Gain by position.** Realized and unrealized, for open and closed positions, in total or for today.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/gain-dark.png">
  <img src="docs/images/gain.png" alt="Gain by position as horizontal bars">
</picture>

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Allocation.** By position or by asset type, with cash as its own slice.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/alloc-dark.png">
  <img src="docs/images/alloc.png" alt="Allocation donut chart">
</picture>

</td>
<td width="50%" valign="top">

**Asset detail.** Price history (1W, 1M, 3M, 1Y) with the 52-week range, company data and quarterly earnings against the analyst consensus.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/price-dark.png">
  <img src="docs/images/price.png" alt="Price history chart with the 52-week range">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/earn-dark.png">
  <img src="docs/images/earn.png" alt="Quarterly earnings against consensus">
</picture>

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Before you buy.** For any asset you hold or follow, the card shows:

- how a monthly contribution would change the portfolio's sector exposure, concentration and volatility;
- how similar the asset is to what you already own;
- what dollar-cost averaging into it would have looked like over 1, 3 or 5 years, including its worst drawdown.

It describes the past and never says "buy".

</td>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/before-dark.png">
  <img src="docs/images/before.png" alt="Before-you-buy analysis card" width="85%">
</picture>

</td>
</tr>
</table>

Also included:

- **Activity and import.** Add, edit and delete buys, sells, dividends, deposits, withdrawals and splits. CSV import recognizes the format from the headers: either the app's own format (the one its CSV export writes, so a backup can be restored) or an export from [Delta](https://delta.app), a popular portfolio-tracking app. A preview shows what will be loaded and flags likely duplicates, and a whole import can be undone.
- **Watchlist** of up to 50 symbols with each one's change for the day.
- **Multiple portfolios**, up to five (for example, one for stocks and one for crypto), plus an "all together" view that adds them up without mixing their ledgers.
- **Installable PWA** with an offline screen and dark mode that follows the system setting.
- **iPhone widget** built on [Scriptable](https://scriptable.app), showing value and today's gain, authenticated by a personal read-only code.

## Architecture

```mermaid
flowchart LR
    subgraph Phone["iPhone / browser"]
        UI["React UI<br/>(receives preformatted text)"]
        W["Scriptable widget"]
    end

    subgraph Vercel["Vercel: Next.js 16"]
        RSC["Server Components<br/>+ Server Actions"]
        API["/api/widget"]
        CRON["/api/cron/*"]
        ENG["lib/engine<br/>pure calculation"]
    end

    subgraph Supabase
        AUTH["Auth<br/>email OTP"]
        DB[("Postgres<br/>row-level security")]
    end

    Y["Yahoo Finance"]

    UI <--> RSC
    W -- "Bearer code" --> API
    RSC --> ENG
    API --> ENG
    RSC <--> AUTH
    RSC <-- "user session, RLS" --> DB
    API -- "widget_ledger()" --> DB
    CRON -- "daily closes" --> DB
    CRON --> Y
    RSC -- "on-demand quotes, rate-limited" --> Y
```

On each page request the server reads the user's ledger and the stored prices under row-level security, runs the engine, and sends the client text that is already formatted. The client never receives raw amounts or the calculation code.

## Why it is built this way

Each decision below answers a concrete constraint. The full log, with the alternatives that were considered, is in [`docs/decisions.md`](docs/decisions.md) (in Spanish).

**1. The ledger is the only source of truth.** No stored positions or balances can drift out of sync. Editing a trade from a year ago, undoing an import or adding a split replays the ledger, and every number updates. The cost is recomputing on every request. The full dashboard renders in about a second with no cache, and the first bytes stream in around 10 ms, so there is nothing to invalidate. Every add, edit or delete is first checked against the whole ledger (`validateLedgerChange`), so a change can't leave a position below zero.

**2. The engine is pure.** `lib/engine` takes transactions, prices and "today" as arguments and returns results. It never imports the database client or the network and never calls `Date.now()`, and ESLint enforces this. The same code serves:

- the dashboard;
- the import preview ("how your portfolio would look");
- the widget;
- the what-if card.

Because it is pure, it can be tested exhaustively with fixed dates and property-based tests.

**3. Money never touches a float.** Amounts stay `decimal.js` values from the database to the formatter. Postgres `numeric` columns are read as text, and provider prices arrive as decimal strings. The only deliberate `number` is XIRR, because it is a rate shown to the user, not an amount. An acceptance test imports a full export from the Delta tracking app and must reproduce the expected cost basis, realized gain and cash to the last decimal.

**4. Portfolios are never merged.** Average cost is tracked per account. Merging ledgers would mix average costs and apply a split once for each account that holds the stock. Instead, the "all together" view computes each portfolio on its own and adds the results (`combineEngineResults`, `combineSeries`).

**5. Market data is stored, not fetched per visit.** Free providers rate-limit, and Vercel Hobby allows one daily cron. A cron stores daily closes, with at least five years per instrument so the five-year what-if works, and pages read only the database.

- Stored closes are already split-adjusted by the provider, so historical values are un-adjusted using the `SPLIT` entries in the ledger.
- "Refresh prices" fetches live quotes, with a per-user limit, and appends them as the last point of each series. It updates every series and the benchmark together, or none of them.

**6. The server formats, the client renders.** Client components never import the engine or the formatter, which keeps `decimal.js` out of the browser bundle. Every amount is formatted in one place (es-UY locale, Montevideo time), so the same value never looks different on two screens.

**7. Authorization lives in the database.** Every user table has row-level security, and the default privileges for `anon` and `authenticated` are revoked: each migration that creates a table declares its own `GRANT` and policies. The proxy only redirects. Every page and action verifies the session again with `getClaims()`, and RLS decides what it can read. The secret key is used only by:

- crons;
- instrument creation;
- the widget, which may call only one SQL function (`widget_ledger`, executable by nothing but the service role). That function works out from the code whose data to return.

**8. Codes instead of passwords or links.** On iOS a magic link opens in Safari instead of the installed app, so sign-in uses a 6-digit code, limited to 5 attempts per 15 minutes per email. Supabase's public API would let a user set a password and skip that limit, so a trigger deletes any password hash as soon as Auth writes one. Sign-up is restricted to an allowlist by a "before user created" hook.

**9. Nothing in the browser can read the session.** Session cookies are `HttpOnly`, and there is no Supabase client in the browser at all. That allows a Content Security Policy of `connect-src 'self'`: the page can only talk to its own origin.

**10. Provider data is untrusted input.** Every Yahoo response is validated with Zod, field by field. A broken field in company data leaves that field empty instead of failing the page, and failures are never cached.

**11. The widget is long-lived code on someone's phone.** The script is updated by hand, so the endpoint only adds fields and never removes or renames them. The code travels in a header, never in a URL, and only its SHA-256 is stored. If refreshing quotes takes longer than 5 seconds, the widget shows the stored values.

**12. Offline means "last known", never cached financial data.** The service worker caches only the offline screen. The last snapshot shown is kept in `localStorage` as preformatted text and is cleared on the sign-in page.

## Stack

| Layer         | Choice                                                               |
| ------------- | -------------------------------------------------------------------- |
| Framework     | Next.js 16 (App Router, Server Components, Server Actions), React 19 |
| Language      | TypeScript, strict mode                                              |
| Data and auth | Supabase: Postgres with row-level security, Auth with email OTP      |
| UI            | Tailwind CSS 4, shadcn/ui on Base UI, Recharts, Lucide               |
| Math          | decimal.js, date-fns / date-fns-tz                                   |
| Validation    | Zod 4 at every boundary: forms, CSV, provider responses              |
| Market data   | `yahoo-finance2` behind a swappable provider interface               |
| Tests         | Vitest, fast-check                                                   |
| Hosting       | Vercel Hobby with Vercel Cron                                        |
| CI            | GitHub Actions: lint, typecheck, unit tests                          |

## Quickstart

Requires Node 22+, pnpm 11 and a free [Supabase](https://supabase.com) project. Supabase runs only in the cloud, so Docker isn't needed.

```bash
pnpm install
cp .env.example .env.local          # fill in your Supabase URL and keys, and a CRON_SECRET

# point the scripts at your development project:
# put its ref under "dev" in supabase/projects.json, then
pnpm supabase login
pnpm supabase link --project-ref <your-ref>
pnpm db:push                        # apply the migrations
pnpm db:config-diff                 # review the Auth config diff before applying it
pnpm supabase config push

pnpm dev                            # http://localhost:3000
```

Next, set up your own SMTP server in the Supabase dashboard so sign-in codes get delivered (the SMTP settings never go in the repo), and add your email to the allowlist:

```sql
insert into public.allowed_emails (email) values ('you@example.com');
```

To try the app with data, import the sample Delta export [`lib/engine/__fixtures__/delta_export.csv`](lib/engine/__fixtures__/delta_export.csv) from **Más → Importar operaciones**.

### Environment variables

| Variable                               | Purpose                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                                                                              |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key. Public by design: the data is protected by RLS                                                   |
| `SUPABASE_SECRET_KEY`                  | Secret key, server only. Bypasses RLS                                                                             |
| `CRON_SECRET`                          | Bearer token for `/api/cron/*`, at least 32 characters (`openssl rand -hex 32`). Without it the crons fail closed |
| `MARKET_DATA_PROVIDER`                 | `yahoo`                                                                                                           |
| `APP_TIMEZONE`                         | `America/Montevideo`                                                                                              |

## Commands

| Command                          | What it does                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build`        | Development server / production build                                                               |
| `pnpm test`                      | Unit tests: engine, importers, views, formatting, security headers, widget                          |
| `pnpm test:integration`          | RLS isolation, invite-only sign-up, atomic imports and rate limits, against the development project |
| `pnpm test:live`                 | Runs the real cron against Yahoo and loads every screen over HTTP with a real session (manual)      |
| `pnpm lint`                      | ESLint, including the rules that keep `lib/engine` pure                                             |
| `pnpm typecheck`                 | `next typegen` + `tsc --noEmit`                                                                     |
| `pnpm db:push` / `pnpm db:types` | Apply migrations / regenerate database types (development project only)                             |

The `db:*` scripts and the integration tests refuse to run against any project other than the one listed as `dev` in `supabase/projects.json`.

## Repository layout

```
app/
  (app)/            Home, Positions, Activity, Watchlist, More
  (auth)/login/     Sign-in with an email code
  api/cron/         Daily prices and backfill (Bearer CRON_SECRET)
  api/widget/       iPhone widget endpoint
lib/
  engine/           Pure calculation: positions, cash, series, TWR, XIRR, risk, what-if
  importers/        CSV parsers (app format and Delta) with format detection
  portfolio/        Database reads, view models and formatting for the UI
  market-data/      Provider interface, Yahoo client, validation and sanitizing
  market-jobs/      Cron jobs: backfill, daily closes, split and dividend re-adjustments
  db/               Supabase clients, session, cookie options, generated types
  widget/           Widget response and the Scriptable script
  security/         Content Security Policy
  validation/       Zod schemas for every input
supabase/
  migrations/       Schema, RLS policies and SQL functions (18 migrations)
  templates/        Auth email templates
docs/               Design log, operations and user guides (in Spanish)
```

## Documentation

The project was built in phases from a written spec, with a decision log kept along the way. The spec is in English and the rest of the documentation is in Spanish.

| Document                                                   | Covers                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [PROJECT_SPEC.md](PROJECT_SPEC.md)                         | Full specification: data model, engine rules, market data, import, phases      |
| [docs/decisions.md](docs/decisions.md)                     | Decision log: deviations from the spec, trade-offs, incidents, security review |
| [docs/supabase-setup.md](docs/supabase-setup.md)           | Environments, keys, invitations, SMTP, crons                                   |
| [docs/limits.md](docs/limits.md)                           | Free-tier limits that shaped the design                                        |
| [docs/importar-csv.md](docs/importar-csv.md)               | CSV import guide for users                                                     |
| [docs/widget-iphone.md](docs/widget-iphone.md)             | Widget setup guide                                                             |
| [docs/comprobacion-manual.md](docs/comprobacion-manual.md) | Manual acceptance checklist                                                    |
| [CLAUDE.md](CLAUDE.md)                                     | Project rules for contributors and coding agents                               |

## Status

Phases 0 to 6 are done:

- calculation engine and Delta importer;
- database with RLS and invite-only access;
- market data and crons;
- the full interface, watchlist and asset detail;
- PWA and widget;
- multiple portfolios and crypto.

The app runs on Vercel against the development database. Next up are the production environment, a strict nonce-based CSP, and import from IBKR Flex Queries.

## License

[MIT](LICENSE). Market data comes from Yahoo Finance and is shown only to invited users. This project is not affiliated with Yahoo.
