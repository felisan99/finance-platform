# Portfolio Tracker — Project specification

> Reference document for building the project with Claude Code.
> Keep it at the repository root as `PROJECT_SPEC.md` and reference it from `CLAUDE.md` (see section 14).
>
> **Change 2026-09-23:** no local Supabase (no Docker). Work happens on two cloud projects: `finance-dev` (development) and `finance` (production). Affects sections 3, 5.3, 5.4, 13, 14.1 and 14.2.
>
> **Change 2026-09-24:** the TWR formula (section 6.5) was corrected to match the start-of-day flow convention. The previous one, `(V_t − F_t) / V_{t−1} − 1`, corresponds to an end-of-day flow and divides by 0 on the first day.
>
> **Change 2026-09-24 (Phase 2):** the list of allowed emails lives in the `allowed_emails` table (queried by Supabase Auth's "Before User Created" hook), not in an environment variable; and the Supabase variables use the names of the new keys (`PUBLISHABLE_KEY`, `SECRET_KEY`). Affects sections 3, 5.4, 11, 13 and 14.1.
>
> **Change 2026-09-24 (Phase 3):** `getDailyHistory` returns bars and events (splits/dividends) from the same response; `instruments` gains `history_from`; there is a `market_job_runs` table (run log) and an `active_instruments()` function. Affects sections 5.2, 7.1 and 7.2; details in `docs/decisions.md`.
>
> **Change 2026-09-24 (Phase 4):** 4-tab navigation (the Watchlist tab arrives in Phase 6), a single account, two-step import with an atomic SQL function (§8.2), per-user rate limits in the database, and "Refresh prices" limited to once every 5 minutes (§7.2). Affects §8.2 and §10; details in `docs/decisions.md`.
>
> **Change 2026-09-24 (allocation):** the allocation in section 6.6 (by position and by type, with cash separate) has been on Home since Phase 4; Phase 5 keeps the historical series, TWR, XIRR and benchmark. Details in `docs/decisions.md`.
>
> **Change 2026-09-24 (Phase 5):** the benchmark (`SPY`) is seeded as an instrument and the price jobs maintain it (`active_instruments()` includes it); the historical series un-adjusts splits with the ledger's `SPLIT` entries; XIRR is computed only for 30 days or more. Conventions in sections 6.4 and 6.5; details in `docs/decisions.md`.
>
> **Change 2026-09-24 (Phase 6 prerequisite):** sign-in with an email link doesn't work for the PWA on iPhone. Before Phase 6 (and before inviting anyone), switch to a 6-digit OTP code with our own SMTP. Affects section 14.2.
>
> **Change 2026-09-25 (Phase 6):** sign-in is with a 6-digit code (own SMTP with a dedicated Gmail account, templates in the repo and a limit of 5 attempts per 15 minutes per email); the Watchlist has a read SQL function (`watchlist_market`) and a 50-symbol cap; the PWA has a minimal service worker (only the offline screen, no caching of pages or data), a last known state stored on the device, and dark mode follows the system through CSS. Affects §10.4, §10.6, §11 and §14.2; details in `docs/decisions.md`.

---

## 1. Vision

A personal web app to track an investment portfolio (US stocks and ETFs, broker Interactive Brokers; since 2026-09-28 also crypto in USD, in separate portfolios) with serious performance metrics, installable on the iPhone as a PWA, with **zero running cost**, and shareable with a few friends, each with their own isolated data.

### Goals
- Record every operation (buys, sells, dividends, deposits, withdrawals, fees, splits) and derive **positions, cash and metrics** from them. Transactions are the single source of truth.
- Show: total value (positions + cash), unrealized and realized gain, time-weighted return (TWR) against the S&P 500, money-weighted return (XIRR), allocation by asset, dividends and a watchlist.
- Import history from the CSV exported by **Delta** (format in section 8) and, later, from **IBKR Flex Query**.
- Mobile-first, installable on the iPhone home screen.
- Simple multi-user: each user sees only their own data (Row Level Security).

### Non-goals (for now)
- Placing orders or connecting to the broker to trade.
- Real-time prices: the daily close plus a delayed "recent" quote is enough.
- Tax reports.
- Options, futures and crypto. The model must allow adding them later, but they are not implemented now.
- Commercial use: Vercel's Hobby plan doesn't allow it.

---

## 2. Constraints

| Constraint | Implication |
|---|---|
| Zero cost | Vercel Hobby + Supabase Free + free price APIs. Any paid service is optional. |
| Non-commercial use | Sharing it with friends for free is fine; charging or showing ads is not. |
| Low compute | No always-on processes: everything is serverless functions and crons. |
| Free API limits | Cache prices in the database; never query the external API on every visit. |
| Third-party data | Showing prices privately to a few users is acceptable; don't expose market data publicly. |

> Free-plan limits (Vercel Cron, Supabase inactivity pausing, API quotas) change over time. Check them at the start and document them in `docs/limits.md`.

---

## 3. Tech stack

- **Framework**: Next.js (App Router) + TypeScript in `strict` mode.
- **UI**: Tailwind CSS + shadcn/ui. Charts with Recharts.
- **Database, auth and security**: Supabase (Postgres + Supabase Auth with email magic link + RLS).
- **Supabase environments**: no local Supabase (no Docker). Two cloud projects: `finance-dev` (development) and `finance` (production, Phase 7).
- **Database client**: `@supabase/ssr` for server components, route handlers and the proxy (formerly middleware; in Next 16 it is called `proxy.ts`).
- **Validation**: Zod for inputs, CSV parsing and external API responses.
- **Market data**: `yahoo-finance2` (npm) behind a `MarketDataProvider` interface, with Finnhub or Twelve Data (free API key) as an alternative provider.
- **CSV**: `papaparse`.
- **Dates and numbers**: `date-fns` + `date-fns-tz`. For money, `decimal.js` or integer cents: **never floats for persisted amounts**.
- **Tests**: Vitest (unit tests for the calculation engine) + Playwright (optional, main flows).
- **PWA**: web app manifest + a simple service worker (Serwist or a minimal hand-written SW).
- **Hosting**: Vercel (Hobby). Crons with Vercel Cron or, as an alternative, GitHub Actions.
- **Package manager**: pnpm.

---

## 4. Architecture

```
[iPhone PWA / browser]
        │
        ▼
[Next.js on Vercel]
  ├─ Server Components  → read from Supabase (with RLS, user session)
  ├─ Server Actions / Route Handlers → writes validated with Zod
  ├─ /api/cron/*        → jobs protected by CRON_SECRET (use the service role)
  └─ lib/engine/*       → PURE calculation engine (no I/O, 100% testable)
        │
        ▼
[Supabase Postgres]  ← user tables (RLS) + shared market tables
        ▲
        │ daily cron
[MarketDataProvider] → Yahoo (primary) / Finnhub (alternative)
```

### Principles
1. **Transactions are the single source of truth.** Positions, cash and metrics are computed; they are not stored as editable state.
2. **The calculation engine is pure** (`lib/engine`): it receives transactions, prices and exchange rates and returns results. No database or network access, so it can be tested thoroughly.
3. **Market data is shared across users** (instruments, prices): stored once and updated by the cron.
4. **Swappable data provider**: every external query goes through `MarketDataProvider`.
5. **Cache first**: the UI only reads from the database. If a price is missing, the last known one is shown with its date.

---

## 5. Data model (Postgres / Supabase)

### 5.1 User tables (with RLS: `user_id = auth.uid()`)

```sql
-- Profile
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  base_currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create table portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  benchmark_symbol text not null default 'SPY',
  created_at timestamptz not null default now()
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  portfolio_id uuid not null references portfolios on delete cascade,
  name text not null,              -- e.g. "IBKR"
  currency text not null default 'USD',
  cost_method text not null default 'AVERAGE' check (cost_method in ('AVERAGE','FIFO')),
  created_at timestamptz not null default now()
);

create type tx_type as enum (
  'BUY','SELL','DIVIDEND','DEPOSIT','WITHDRAWAL','FEE','INTEREST','SPLIT','TAX'
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid not null references accounts on delete cascade,
  type tx_type not null,
  instrument_id uuid references instruments,     -- null for account-level DEPOSIT/WITHDRAWAL/FEE/INTEREST
  executed_at timestamptz not null,
  quantity numeric(20,8),                         -- shares (fractional allowed)
  price numeric(20,8),                            -- unit price WITHOUT fees
  amount numeric(20,4),                           -- cash amount (dividends, deposits, etc.)
  fee numeric(20,4) not null default 0,
  currency text not null default 'USD',
  split_ratio numeric(20,8),                      -- for SPLIT: new/old (e.g. 10 for 10:1)
  notes text,
  source text not null default 'manual',          -- 'manual' | 'delta_csv' | 'csv' | 'ibkr_flex'
  import_id uuid,                                 -- the import it came from (to undo it); null if manual
  external_id text,                               -- to deduplicate imports
  created_at timestamptz not null default now(),
  unique (account_id, source, external_id)
);

create table watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'Watchlist'
);

create table watchlist_items (
  watchlist_id uuid references watchlists on delete cascade,
  instrument_id uuid references instruments,
  user_id uuid not null references auth.users on delete cascade,
  added_at timestamptz not null default now(),
  primary key (watchlist_id, instrument_id)
);

create table imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid references accounts,
  source text not null,
  filename text,
  rows_total int, rows_imported int, rows_skipped int,
  report jsonb,                                   -- per-row errors and warnings
  created_at timestamptz not null default now()
);
```

*(**Multiple portfolios**, 2026-09-28: each person has 1 to 5 portfolios, for example one for stocks and one for crypto, and each portfolio has exactly one account, which the app doesn't show: the ledger and the average cost are still per account, so the same symbol in two portfolios is never mixed. Names have no leading or trailing spaces, are up to 40 characters and are unique per person, case-insensitively. `create_portfolio` creates the portfolio with its account; the `portfolios_check_limit` and `portfolios_keep_one` triggers enforce the cap and prevent deleting the last one (except when the person is deleted). Migration `multiple_portfolios`.)*

### 5.2 Market tables (shared; readable by authenticated users, writable only with the service role)

```sql
create table instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,          -- canonical symbol, e.g. 'VOO', 'BRK-B'
  name text,
  type text,                            -- 'STOCK' | 'ETF' | 'CRYPTO'
  exchange text,
  currency text not null default 'USD',
  sector text, industry text,
  provider_symbol text,                 -- symbol at the provider, if different
  history_backfilled_at timestamptz,
  history_from date,                    -- start date of the last backfill request (Phase 3)
  created_at timestamptz not null default now()
);

create table prices_daily (
  instrument_id uuid references instruments on delete cascade,
  date date not null,
  close numeric(20,6) not null,
  adj_close numeric(20,6),
  primary key (instrument_id, date)
);

create table quotes_latest (
  instrument_id uuid primary key references instruments on delete cascade,
  price numeric(20,6) not null,
  change numeric(20,6), change_pct numeric(10,6),
  as_of timestamptz not null
);

create table corporate_actions (          -- splits and dividends detected from the provider
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid references instruments,
  type text not null,                     -- 'SPLIT' | 'DIVIDEND'
  ex_date date not null,
  ratio numeric(20,8), amount numeric(20,6),
  unique (instrument_id, type, ex_date)
);
```

> Phase 3: there is also `market_job_runs` (durable log of cron runs; used only by the server) and the `active_instruments()` function (instruments with transactions or on any user's watchlist; `service_role` only). See `docs/decisions.md`.

### 5.3 RLS
- Enable RLS on **every** table.
- User tables: `select/insert/update/delete` policies with `user_id = auth.uid()`.
- Market tables: `select` for the `authenticated` role; no write policies. Only the cron writes, with the service role key on the server.
- The service role key **never** reaches the client.
- Write an integration test (or a SQL script) that verifies user A can't read user B's data. Since there is no local database, the test runs against `finance-dev` (test users created with the service role key and deleted at the end); never against `finance`.

### 5.4 Migrations
Supabase CLI (`supabase/migrations/*.sql`). Every schema change is a versioned migration. They are applied with `supabase link` + `supabase db push` to the linked project (`finance-dev` in development). There is no local database and no `supabase db reset`; check the linked project's ref before every push. The `finance` (production) project is touched only in Phase 7 and with explicit confirmation. The applied migrations are the source of truth for the schema; their differences from the SQL in section 5.1 are listed in `docs/decisions.md`.

---

## 6. Calculation engine (`lib/engine`)

A **pure** TypeScript module. Input: transactions of an account or portfolio, daily prices, recent quotes and splits. Output: typed structures.

### 6.1 Positions
Walk the transactions in chronological order (with a stable tiebreak on `created_at`):

- **BUY**: `qty += quantity`; `cost_basis += quantity * price + fee`.
- **SELL** (average method, default):
  - `avg_cost = cost_basis / qty`
  - `proceeds = quantity * price - fee`
  - `realized += proceeds - quantity * avg_cost`
  - `cost_basis -= quantity * avg_cost`; `qty -= quantity`
- **SELL** (FIFO, optional per account): consume lots in order and compute the realized gain per lot.
- **SPLIT**: `qty *= ratio`; `cost_basis` doesn't change. Earlier historical prices are adjusted when comparing.
- **DIVIDEND**: doesn't change the quantity; adds to `dividends_received` and to cash.
- If `qty` ends up at ~0 (tolerance `1e-9`), the position is closed; its realized gain is kept.
- Validation error if a sell would make the quantity negative (shorting isn't supported).

Output per position: `symbol, qty, avg_cost, cost_basis, market_value, unrealized_pnl, unrealized_pct, realized_pnl, dividends, day_change, weight`.

### 6.2 Cash
Per account: `cash = Σ DEPOSIT − Σ WITHDRAWAL − Σ (BUY qty*price + fee) + Σ (SELL qty*price − fee) + Σ DIVIDEND + Σ INTEREST − Σ FEE − Σ TAX`.
If cash goes negative, show a warning (likely a missing transaction) without blocking.

### 6.3 Portfolio value
`total_value = Σ market_value + cash`. The market price comes from `quotes_latest` if it is from today; otherwise from the last `prices_daily.close`, showing its date.
*(Exact rule in `pickPrice`, `lib/engine/valuation.ts`: the quote wins if its day is the same as or later than the last close's.)*

### 6.4 Daily historical series
For each business day since the first transaction: rebuild quantities and cash as of that date and value them with `prices_daily`. For days without a price (holidays), use the last known close. Keep the computed series in memory or in a cache; it is not a source of truth.
*(Done in Phase 5, `lib/engine/series.ts`: business days in New York time. Closes, which are split-adjusted backwards, are multiplied by the ratio of the ledger's `SPLIT` entries that haven't happened yet, so price and quantity are in the same units. With no earlier close, the position is valued at cost. Recomputed on every request, no cache.)*

*(**Crypto and weekends**, 2026-09-28: the grid is still business days, so crypto daily returns are comparable with stocks' and volatility is annualized with 252.
- Crypto trades every day. If the series ends on a Saturday or Sunday (there is a quote or close for that day), that day is the **last point**, so the chart ends on the Home value. A transaction from that weekend counts there.
- On Monday that point disappears and Monday absorbs the weekend's move.
- The live point is still all or nothing with the benchmark on business days. On a weekend, a stock benchmark that doesn't trade keeps its last close.
- In "Before you buy", returns are also measured on business days, even when comparing two cryptos.)*

*(**Live point**, `lib/portfolio/live-series.ts`: the cron stores the close once a day, after the session, so during the session the series ended yesterday while the Home value already used the quote. Now, if a quote is from a trading day after the last close of its series, it is added as the last point (New York day, without touching `lib/engine`: it enters as one more close). It feeds the chart, TWR, XIRR, the period gain, monthly returns, risk, sparklines and a position's price chart. It is all or nothing between the portfolio and the benchmark: if the benchmark's live quote isn't for the same day, no series gets a live point and they stay on closes. With no earlier close there is no point either (a jump from cost to market is not a return). If the quote is from the same day as the last close, the close wins; when the day's close arrives, the live point disappears on its own. The card labels it ("closes as of 09/24 and quote from 09/25 11:47").)*

### 6.5 Returns
- **External flows** = `DEPOSIT` (+) and `WITHDRAWAL` (−). Buys, sells and dividends are internal.
- **TWR (time-weighted)**, chained daily:
  `r_t = V_t / (V_{t−1} + F_t) − 1`, where `V_t` is the value at the close of day t and `F_t` the net external flow on day t (convention: the flow happens at the start of the day, so it is part of that day's base; document it in the code). On the first day `V_{t−1} = 0` and the base is just the deposit.
  `TWR = Π (1 + r_t) − 1`. Annualize only if the period is longer than 1 year.
- **XIRR (money-weighted)**: signed external flows (from the investor's point of view), plus the final value as a positive flow. Solve with Newton-Raphson, with bisection as a fallback.
- **Benchmark**: return of `benchmark_symbol` (default SPY) over the same period, using `adj_close` to include dividends. Chart with both series normalized to 100.
- Periods: 1W, 1M, 3M, YTD, 1Y, All.
*(Done in Phase 5, `lib/engine/{returns,performance}.ts`. The period is `(base day, today]`. XIRR with Newton and bisection, as a `number` (it is a rate for display), and only for periods of 30 days or more. A period longer than the history is trimmed to All.)*

### 6.6 Allocation
By instrument, by type (stock/ETF) and by sector when available. Cash appears as its own category.
*(Done in Phase 4 by instrument and by type: `lib/engine/allocation.ts`. Sector is left for later: ETFs don't have one.)*

### 6.7 Numeric rules
- Use decimals for money; round only for display.
- Quantity tolerance `1e-9`; fractional shares with up to 8 decimals.
- All dates in UTC in the database; the UI shows `America/Montevideo` time. To assign a transaction to a "market day", use New York time.

---

## 7. Market data

### 7.1 Interface

```ts
interface MarketDataProvider {
  search(query: string): Promise<InstrumentSearchResult[]>;
  getQuotes(symbols: string[]): Promise<Quote[]>;
  // Bars + splits/dividends from the SAME response: two separate queries could land on either
  // side of a split and leave adjusted prices with stale events.
  getDailyHistory(symbol: string, from: Date, to: Date): Promise<DailyHistory>;
  getProfile?(symbol: string): Promise<InstrumentProfile>;
  // Asset detail (§10.2): company or fund data and intraday bars. They don't store anything.
  getCompanyData?(symbol: string, kind: "stock" | "etf"): Promise<CompanyData>;
  getIntradaySeries?(symbol: string, range: "1w" | "1m"): Promise<IntradayPoint[]>;
}
```

- Primary implementation: `YahooProvider` (`yahoo-finance2`). It isn't an official API: wrap everything in try/catch, validate with Zod and log failures.
- Alternative implementation: `FinnhubProvider` or `TwelveDataProvider`, chosen with the `MARKET_DATA_PROVIDER` environment variable.
- Simple rate limiting plus retries with exponential backoff.
- Only `YahooProvider` is implemented (Phase 3); `MARKET_DATA_PROVIDER` accepts the other two names but they answer "not implemented".
- Provider amounts are decimal strings rounded exactly once (Yahoo returns float32 noise, e.g. `1730.97998046875`).
- **Company data** (`getCompanyData`): `quoteSummary` with `summaryDetail` and `defaultKeyStatistics` (stocks and ETFs) and, only for stocks and in a separate query, `earningsHistory` and `calendarEvents` (earnings for the last 4 quarters and the next report date). An ETF has no earnings: Yahoo answers "No fundamentals data found", which is treated as "none" and not retried. A crypto shows "Coin data" (prices, range, volume and market cap, to the cent) and doesn't request earnings. Each field is validated on its own with Zod and, if it is missing or changes type, stays empty (the row isn't shown); nothing is discarded because of one broken value. They are informational: they don't feed any calculation and aren't stored.
- **Intraday series** (`getIntradaySeries`): `chart` with 30-minute bars (the week, last 5 sessions) or 1-hour bars (the month).
- What these two queries return is cached on the server (`unstable_cache`: 1 hour for company data, 5 minutes for bars; failures aren't cached). No schema changes.

### 7.2 Jobs (crons)
| Job | Frequency | What it does |
|---|---|---|
| `/api/cron/daily-prices` | Once per business day, after the NY close (e.g. 22:00 UTC) | For every instrument used in a position or watchlist: stores the close in `prices_daily`, updates `quotes_latest` and detects new splits and dividends. |
| `/api/cron/backfill` | When an instrument is created, or in the same daily cron if any are pending | Downloads at least the last 5 years of history (or from the first transaction, if older) and sets `history_backfilled_at`. *(Until 2026-09-28 the 5 years applied only to the watchlist; "Before you buy" needs the last year of the whole portfolio.)* |

- Protect the endpoints with the `Authorization: Bearer ${CRON_SECRET}` header.
- If Vercel Cron's free plan limits the frequency, use GitHub Actions (`schedule:`) calling the endpoint.
- The daily cron also keeps Supabase from pausing the project for inactivity.
- Scheduled in `vercel.json` (`0 22 * * 1-5`, a single schedule: the Hobby maximum). `/api/cron/backfill` exists but isn't scheduled: the daily job already downloads what is pending.
- Yahoo returns a null `close` on some business days and re-adjusts history backwards on every split (`close`) and dividend (`adj_close`): the job drops null bars, detects the re-adjustment and downloads the instrument's full history again.
- "Refresh now" button in the UI: refreshes `quotes_latest` only for the user's positions, limited to once every 5 minutes per user. *(Also for the symbols they follow and for the benchmark, `SPY`: the performance chart compares against it and needs today's quote to end on the same day as the portfolio, §6.4. The benchmark we add doesn't count in the result message.)*

---

## 8. CSV import (simple format and Delta)

### 8.1 Input format (Delta export)
Columns:
`Date, Way, Base amount, Base currency (name), Base type, Quote amount, Quote currency, Exchange, Sent/Received from, Sent to, Fee amount, Fee currency (name), Broker, Notes, Sync Base Holding, Leverage Metadata`

Examples:
```
"2026-03-06T22:30:00.000Z","DEPOSIT",4200,"USD (United States dollar)","FIAT",,,,"OTHER","MY_WALLET",,,"","Comision 30USD",false,
"2026-03-09T22:34:00.000Z","BUY",3,"VOO (Vanguard S&P 500 ETF)","FUND",1725.72,"USD","New York Stock Exchange",,,1,"USD",,,true,
"2026-03-09T22:34:00.000Z","WITHDRAW",1726.72,"USD (United States dollar)","FIAT",,,"New York Stock Exchange","MY_WALLET","OTHER",,,,"SYNC-BASE-HOLDINGS_BUY_VOO/USD",false,
"2026-04-06T22:42:00.000Z","SELL",37,"KOS (Kosmos Energy Ltd)","STOCK",117.105,"USD","New York Stock Exchange",,,1,"USD",,,true,
```

### 8.2 Mapping rules
| Delta row | Resulting transaction |
|---|---|
| `Way=BUY` | `BUY`, `quantity = Base amount`, **`price = Quote amount / Base amount`** (Quote amount is the TOTAL, not the unit price), `fee = Fee amount \|\| 0`. |
| `Way=SELL` | `SELL`, same price and fee calculation. |
| `Way=DEPOSIT` / `WITHDRAW` with `Notes` starting with `SYNC-BASE-HOLDINGS_` | **Ignore.** These are Delta's automatic cash legs; the engine already computes cash from BUY/SELL. |
| `Way=DEPOSIT` without that note and with `Base type=FIAT` | `DEPOSIT` (external flow), `amount = Base amount`. |
| `Way=WITHDRAW` without that note and with `Base type=FIAT` | `WITHDRAWAL` (external flow). |
| Other `Way` values (dividends or others, if they appear) | Map them if possible; otherwise report the row as unsupported. |

- **Symbol**: the text of `Base currency (name)` before the first space (`"VOO (Vanguard S&P 500 ETF)"` → `VOO`). Type: `FUND` → ETF, `STOCK` → STOCK.
- **Date**: ISO in UTC, as is.
- **Deduplication**: `external_id = hash(Date + Way + symbol + Base amount + Quote amount)`.
- **Import flow**: upload file → parse and validate with Zod → **preview screen** (transactions to create, ignored rows with their reason, errors) → confirm → insert in a single database transaction (SQL function `import_transactions`) → store the report in `imports`. Confirming parses the file again from scratch; rows with errors block confirmation.
- Create the symbols that don't exist in `instruments` and queue their backfill.

### 8.3 Fixture and expected results (acceptance test)
Store a Delta export as `lib/engine/__fixtures__/delta_export.csv`. With the average cost method and fees included in cost, the engine must produce:

**Open positions (before the DDOG buy):**
| Symbol | Quantity | Cost basis (USD) |
|---|---|---|
| VOO | 8.95 | 5724.77 |
| SOXX | 4 | 2069.50 |
| FSLY | 30 | 346.80 |
| ILF | 12 | 331.60 |
| NFLX | 2 | 191.60 |
| **Total** | | **8664.27** |

**Closed positions — realized gain:**
| Symbol | Realized (USD) |
|---|---|
| MELI | 180.55 |
| URTH | 42.70 |
| KOS | 11.135 |
| QCOM | 7.52 |
| TTWO | 5.11 |
| **Total** | **247.015** |

**Cash:** external deposits 9300.00 − buys including fees 11696.66 + sells net of fees 3279.405 = **882.745 USD**.

**Manual transaction to test after importing:** `BUY DDOG 2 @ 251.41, fee 1.00, 2026-09-23` → DDOG cost basis 503.82 and cash 378.925.

> Note: Delta's cash balance can differ from this calculation when Delta records dividends that aren't included in the exported CSV. That isn't an engine bug: it is fixed by entering the dividends (manually or through IBKR Flex).

### 8.4 Simple format ("Portfolio Tracker") and the import screen
Almost no user uses Delta, so the main format is our own, simple and documented on screen (`lib/importers/simple.ts`, `docs/importar-csv.md`). **It is the same format "Exportar CSV" writes**: export → import is a round trip (backup, restore, and moving from one database to another). A file is recognized from its headers alone (`lib/importers/detect.ts`): `Way` + `Base amount` → Delta (unchanged); `fecha` + `tipo` → simple.

| Operation | Columns |
|---|---|
| Buy / Sell | `fecha, tipo, simbolo, cantidad, precio` (price **per unit**) and optional `comision` |
| Deposit / Withdrawal / Fee / Tax | `fecha, tipo, monto` |
| Interest | `fecha, tipo, monto` (can be negative) |
| Dividend | `fecha, tipo, simbolo, monto` |
| Split | `fecha, tipo, simbolo, razon_split` (10 = 10:1; 0.1 = reverse 1:10) |

- **Headers** are tolerant (lowercase, no accents, Spanish and English aliases; `fecha_utc` wins over `fecha` and `fecha_montevideo`); extra columns are ignored. **Types** in English (`BUY`…, like the export) or Spanish (`compra`, `venta`, `depósito`, `retiro`, `dividendo`, `split`, `comisión`, `impuesto`, `interés`).
- **Dates:** `YYYY-MM-DD`, `YYYY-MM-DD HH:mm[:ss]`, ISO with a time zone, and `DD/MM/YYYY [HH:mm]` (**day before month**). No time zone = Montevideo time; no time = noon in Montevideo (same day in New York; ties keep the file order). Dates that don't exist (31/02), future dates and dates before 1990 are rejected.
- **Numbers:** decimal point or comma (only one, no thousands separator), with the same digit limits as the manual form. **Delimiter** `,`, `;` or tab, auto-detected (Excel in Spanish saves with `;`); BOM and CRLF are fine. USD only.
- **Deduplication:** `external_id = csv:` + instant + type + symbol + quantities + fee (identical rows in the same file get a `#2`, `#3`… suffix), with `source = 'csv'`.
- **New symbols** (typed by hand, so a typo is likely): verified with the provider (`resolveNewInstrument`), up to 40 per file; one that doesn't exist is an error on that row and blocks the import; if the provider doesn't respond it also blocks (without it there's no telling whether it is a stock or an ETF). Instruments are created with the provider's name and type. Delta isn't verified.
- **Similar to what's already loaded:** manual and imported transactions don't share an identifier; a row with the same day (Montevideo), type, symbol and quantity (or amount) as something already loaded, from any source, is **excluded by default**, listed separately, and imported only if the person checks "Importar igual". Repetitions are counted.
- Downloadable **template** (`/activity/import/plantilla`) with example rows; uploading it untouched, or leaving the examples mixed in, is an error.
- **Input:** a `.csv` file or **rows pasted** from a spreadsheet (they arrive tab-separated). Up to 1 MB and 5000 operations.
- **Preview:** detected format, the interpreted operations (date as day/month/year, type, symbol, quantity and price) for a visual check, errors grouped by cause, the similar ones, and how the portfolio would look.
- **Undoing an import:** every imported transaction stores its `import_id`; `undo_import` deletes the transactions from that import and marks it (`imports.undone_at`), but first the server validates with `validateLedgerChange` (`removeMany`) that the ledger stays consistent (a sell can't be left without its buy). Imports made before this feature can't be undone.

---

## 9. Import from IBKR Flex Query (later phase)

- IBKR lets you define a Flex Query (Trades, Cash Transactions, Corporate Actions) and fetch it through the Flex Web Service with a read-only token.
- Store the token **encrypted** (for example with `pgsodium` or application-level encryption with a key in an environment variable) and only on the server.
- Map: trades → BUY/SELL (with fees), dividends → DIVIDEND, withholdings → TAX, deposits and withdrawals → DEPOSIT/WITHDRAWAL, splits → SPLIT.
- Deduplicate by IBKR's transaction ID (`external_id`).
- Option to sync daily within the cron.
- Check IBKR's current documentation before implementing.

---

## 10. Features and screens

Mobile-first, designed for a 390px width. App-style bottom navigation with: **Home (Inicio), Positions (Posiciones), Watchlist, Activity (Actividad) and More (Más)**.
*(2026-10-28: four tabs, Home and Positions | Watchlist and More, with the **Assistant** as a round button in the middle. Activity moved under More; its route is unchanged. See §10.7.)*

**Multiple portfolios** (2026-09-28): with more than one, Home, Positions and Activity show a selector above the title (a native `<select>`) with the portfolio being viewed. The choice is stored in the `pt-portfolio` cookie (HttpOnly), which the server always checks against the person's portfolios: if it no longer exists or belongs to someone else, the first one is shown. The asset detail shows the portfolio's name without a selector, and Home, Positions, Activity, the export and "Before you buy" belong to the chosen portfolio. There is a single Watchlist for all of them. "Refresh prices" refreshes the positions of every portfolio. With a single portfolio the app looks as before.

**"All together"** (stage 2, 2026-09-28): with more than one portfolio, the selector's first option is "Todos los portafolios" (value `all` in the cookie).
- **Calculation:** the ledger is still per account. The engine runs for each portfolio and the results are then added:
  - `combineEngineResults` adds quantities, cost basis, realized gain and dividends per symbol; the average cost comes from the sum.
  - `combineSeries` adds value, cash and flows day by day and recomputes daily growth on the totals. TWR and XIRR are those of the whole holding, not an average.
  - Mixing the accounts' transactions would be wrong: it would apply a `SPLIT` entered in each one twice and cost sells at the average of all of them.
- **Benchmark:** the one the portfolios share, or SPY if they don't share one.
- **Screens:**
  - Home, Positions, the asset detail and "Before you buy" show the sum.
  - Activity lists everyone's operations, each with its portfolio.
  - "Exportar CSV" downloads everything in one file with a `portafolio` column at the end; the simple format ignores it on import.
  - Adding and importing don't start in any portfolio: one must be chosen.
  - If a portfolio has negative cash, Home names it even if the sum is positive.

**Crypto** (stage 3, 2026-09-28): large coins quoted in USD, entered by hand or with the simple format.
- **Symbol:** the Yahoo pair, `BTC-USD`. `BTC` isn't used: it is the ticker of a Grayscale ETF and they would share prices.
- **Type:** `instruments.type = 'CRYPTO'`.
- **Yahoo:** search offers `CRYPTOCURRENCY` only for `-USD` pairs on the `CCC` exchange; futures (`BTC=F`) and pairs in other currencies (`BTC-EUR`) are left out. Daily bars come in UTC days, weekends included, and the bar for the current UTC day isn't stored: its "session" is the whole day.
- **Screens:**
  - Labeled "Cripto" in Positions, the asset detail, search, the Watchlist and allocation by type.
  - The asset detail shows "Coin data" and no earnings.
  - "Before you buy" groups cryptos as "Cripto".
- **Benchmark:** each portfolio chooses what to compare against, S&P 500 or Bitcoin. "All together" uses the shared one or, if they don't share one, SPY.
- **Import:** crypto still isn't imported from Delta; that's why the unsupported-type message explains how to enter it.

### 10.1 Home (dashboard)
- Total value, change for the day ($ and %), **total gain and net contributions** (value − deposits + withdrawals, with its % over contributions), unrealized and realized gain.
- Chart with a period selector and three modes: **cumulative gain in US$** (default: value − net contributions, with no jumps from deposits), value, and benchmark comparison (portfolio TWR vs. SPY, normalized to 100).
- Cards: TWR, XIRR, available cash, dividends this year.
- **Gain by position**: diverging bars per symbol, open and closed (Total or Today), replacing the day's top gainers and losers.
- Allocation (by position or by type) and **your positions**, the largest ones with a one-month sparkline.
- **Monthly returns** (portfolio vs. benchmark) and **risk** (maximum drawdown, volatility, best and worst day and a drawdown chart; collapsed).
*(Done in Home v2 after Phase 6; see `docs/decisions.md`.)*

### 10.2 Positions
- List sortable by value, day %, gain $ or gain %.
- Toggle to show closed positions.
- Per-position detail: price chart with buy and sell markers, quantity, average cost, cost basis, value, unrealized and realized gain, dividends, weight in the portfolio and transaction history.
- **Asset detail** (a position or a followed symbol): the "Price history" card with a **variable 1W / 1M / 1Y range** (1Y from the stored daily closes with today's quote at the end; 1W and 1M from Yahoo intraday bars, fetched when tapped and remembered on the screen; if Yahoo fails they fall back to daily closes with a notice), the period's change with sign and arrow, and the **52-week range overlaid**: dotted lines at the high and low with their values (always in 1Y; in 1W and 1M only if they fall within the period's scale) and, below, the range bar with the price marked. The 52-week range is the provider's (it includes intraday extremes); if it is missing, the one from stored closes.
- **Company data** (or "fund data" for an ETF): previous close, open, day and 52-week range, volume and average volume (3 months), market cap, P/E (trailing 12 months and forward 12), EPS, annual dividend and yield, shares outstanding and float, P/B, book value, price/sales and beta; for an ETF, also total net assets, NAV, category and year-to-date return. Large quantities are written in words ("4,21 billones", "12,23 mil millones": Spanish long scale). Each missing value is a row that isn't shown.
- **Earnings** (stocks only): actual EPS for the last 4 quarters against analyst consensus, with the verdict in words (**Superó / En línea / No llegó**, "por US$ 0,61") and the next report date. The quarter is labeled by the calendar quarter in which the period ends ("T3 2025").
- **Before you buy** (a position or a followed symbol; it isn't a buy recommendation, and the card says so): one amount chosen from four (the first is the **typical contribution**: the median monthly deposit over the last 12 months; without deposits, US$ 1,000) and two parts:
  - **What it does to your portfolio**, buying it with new money: the symbol's weight, its sector's (ETFs are a separate group: they have no sector), the 3 largest positions and 1-year volatility, before and after; and the **similarity** (correlation of the last year's daily returns with the rest of the portfolio, with a phrase: "moves almost the same" ≥ 0.8, "is quite similar" ≥ 0.5, "moves quite differently" ≥ 0, "tends to move the opposite way") and the position it most resembles. It is today's portfolio with the last year's moves (fixed weights, cash earns 0). A position whose history starts more than a week late is left out with a notice; if the symbol itself has a short history, the window is shortened with a notice; with fewer than 60 common sessions there is no similarity or volatility.
  - **Would you have held on?**: the amount invested on the first business day of each month over 1, 3 or 5 years (12, 36 or 60 contributions; "All" if the symbol listed more recently), with fractions and dividends reinvested (`adj_close`): the amount contributed, what it would be worth today, the same in the benchmark, the **worst moment** (the largest loss over contributions and when it recovered) with the question "Would you have kept buying?" if it exceeded 10 %, and the largest price drop. Chart of contributions, value and the benchmark.
  - Everything comes from `prices_daily` (no calls to Yahoo); the calculation belongs to the pure engine (`lib/engine/what-if.ts`).

### 10.3 Activity (transactions)
- List with filters (type, symbol, date) and adding, editing and deleting.
- Form with symbol autocomplete (the provider's `search`), quantity, price, fee and date.
- When adding a buy or sell, choosing the symbol fetches the **current quote** (`getReferencePrice`, a provider query that doesn't store anything) and fills it into the price, just as date and time start at "now". Below the price it says when the quote is from (if it is the close, the close time is shown). It is editable: if the person already typed a price it isn't overwritten and a "Usar este precio" button remains. It doesn't apply when editing an operation or to types without a per-share price.
- Import CSV (Delta and, later, a generic format) and export everything to CSV as a backup.
- With multiple portfolios: adding asks which one to save to and starts on the one being viewed. Editing and deleting happen in the operation's portfolio, because an operation doesn't move between portfolios. Importing asks which portfolio to import into, and "Deshacer" validates the ledger of that import's portfolio. "Exportar CSV" downloads the chosen portfolio, with its name in the file name; the CSV format doesn't change.

### 10.4 Watchlist
- Add and remove symbols (up to 50, in alphabetical order); see price, change for the day, 52-week range and a sparkline. The range uses the **daily closes** of the last 52 weeks (`prices_daily` doesn't store intraday highs and lows) and the current price is added to the range.
- Tapping a symbol opens the same detail as a position; without a position it shows the price, price history with range (1W/1M/1Y) and the 52-week range, "Before you buy" (§10.2), company data, earnings and the follow/unfollow button, with no costs or operations.

### 10.5 More
- Accounts and portfolios (create, rename, cost method), benchmark, currency, data export, sign out.
*(Done, 2026-09-28: "Portafolios" (`/more/portfolios`) lets you create a new one, which becomes the one being viewed. Each portfolio can be renamed or deleted; deleting requires typing its name, warns how many operations go with it, and the last one can't be deleted. Accounts aren't shown. Stage 3: the benchmark is chosen when creating the portfolio and in its settings, with "Comparar con" S&P 500 (SPY) or Bitcoin (BTC-USD).)*

### 10.6 PWA
- `manifest.webmanifest` with `display: standalone`, icons (including a 180×180 `apple-touch-icon`), `theme_color` and light and dark mode support.
- Respect `env(safe-area-inset-*)` for the iPhone's notch and bottom bar.
- Minimal service worker (`public/sw.js`): it precaches only the offline screen and its files, and shows it when a navigation fails for lack of network. **It doesn't store pages or financial data.** The offline screen shows the last known state of Home, which the app leaves in the device's `localStorage` (preformatted text; it expires after 30 days and is cleared on reaching `/login`).
- Dark mode follows the system (`prefers-color-scheme`), with no manual toggle.

### 10.7 Assistant (added 2026-10-28)
A streaming chat ("Asistente") that answers questions about the portfolio being viewed, in Spanish, citing for every number the function that computed it and the period. Details and rationale: `docs/decisions.md`, "Asistente con LLM".
- **Agent:** a ReAct tool-calling loop (Vercel AI SDK + OpenRouter free models, with a fallback model), capped at 6 steps per question.
- **Tools (read-only, over `lib/engine`):** positions and cash; realized and unrealized gain by asset and period; performance (TWR, XIRR, gain, benchmark); what moved the portfolio between two dates (per-position contribution); an asset's price history; the "what if I buy" scenario; a buy/sell simulation at today's prices (weights and cash before and after); allocation by type, sector or a chosen group of symbols; risk (concentration, drawdown, volatility); news (Tavily); and long-term memory. The model never computes: tools return preformatted text, the source and the missing data.
- **Memory:** conversation history, an automatic summary of old messages, and up to 30 stable facts per person (risk profile, goals), never portfolio figures.
- **Guardrails:** it acts as an opinionated advisor that recommends concrete actions (a change requested on 2026-10-28), but every portfolio figure comes from a tool and it never computes one; it cannot trade; it says "no tengo ese dato" instead of guessing; it only sees the signed-in person's data (RLS); it declines off-topic requests; news is untrusted content.
- **Observability and evals:** per-turn metrics (tools, tokens, latency, errors) and an eval suite of ~40 questions over a fictitious demo portfolio whose correct answers are computed by the engine.

---

## 11. Security and privacy

- RLS on every table (section 5.3), with a test that verifies it.
- The service role key and `CRON_SECRET` only in server environment variables.
- Validate every input with Zod in server actions and route handlers.
- Sign-in with a **6-digit code** sent by email (own SMTP; there is no link), with a limit on verification attempts per email; sign-up by **invitation** only (list of allowed emails in the `public.allowed_emails` table, queried by Supabase Auth's "Before User Created" hook), so the app isn't open to anyone. Allowing someone in means inserting their email into that table.
- No third-party analytics.
- Full export of the user's data (CSV or JSON) and an option to delete the account.

---

## 12. Repository structure

```
/
├─ app/
│  ├─ (auth)/login/
│  ├─ (app)/            # layout with bottom navigation
│  │  ├─ page.tsx       # Home
│  │  ├─ positions/ [symbol]/
│  │  ├─ activity/ import/
│  │  ├─ watchlist/
│  │  └─ settings/
│  └─ api/cron/{daily-prices,backfill}/route.ts
├─ lib/
│  ├─ engine/           # pure engine + tests + __fixtures__
│  │  ├─ positions.ts cash.ts valuation.ts returns.ts allocation.ts
│  │  └─ __tests__/
│  ├─ market-data/      # interface + providers (yahoo, finnhub)
│  ├─ importers/        # delta.ts, ibkr-flex.ts (+ tests)
│  ├─ db/               # Supabase clients, typed queries
│  └─ validation/       # Zod schemas
├─ components/          # UI (shadcn + our own)
├─ supabase/migrations/
├─ public/              # manifest, icons
├─ docs/                # limits.md, architecture decisions
├─ CLAUDE.md
└─ PROJECT_SPEC.md
```

---

## 13. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # publishable key (sb_publishable_…)
SUPABASE_SECRET_KEY=              # secret key (sb_secret_…), server only
CRON_SECRET=
MARKET_DATA_PROVIDER=yahoo        # yahoo | finnhub | twelvedata
FINNHUB_API_KEY=                  # optional
APP_TIMEZONE=America/Montevideo
OPENROUTER_API_KEY=               # assistant (server only)
ASSISTANT_MODEL=                  # OpenRouter model id, e.g. a `:free` one with tool support
ASSISTANT_FALLBACK_MODEL=         # optional
TAVILY_API_KEY=                   # optional: news search
```

Include `.env.example` in the repo and never commit `.env.local`. `.env.local` points to the `finance-dev` project; the credentials for `finance` (production) live only in Vercel's environment variables. The list of emails with access is no longer a variable: it lives in the `allowed_emails` table.

---

## 14. Working with Claude Code

### 14.1 Suggested `CLAUDE.md` (repository root)
```md
# Context
Personal portfolio tracker. The full specification is in PROJECT_SPEC.md: read it before any large task.

# Rules
- Strict TypeScript. No `any` without a justification.
- lib/engine is PURE: no Supabase imports, no fetch, no implicit Date.now() (take "today" as a parameter).
- Money with decimal.js; never float arithmetic for persisted amounts.
- Every schema change = a new migration in supabase/migrations.
- Every new engine calculation gets Vitest tests, edge cases included.
- Validate inputs with Zod on the server.
- Never expose SUPABASE_SECRET_KEY to the client.
- Supabase only in the cloud (no Docker, no local stack): `finance-dev` for development and `finance` for production. No link/push to `finance` without an explicit request.

# Commands
pnpm dev | pnpm test | pnpm lint | pnpm typecheck | supabase db push (dev only)
```

### 14.2 Phases (one Claude Code session or PR per phase)

**Phase 0 — Setup**
Next.js + TypeScript + Tailwind + shadcn, `pnpm dlx supabase init` (no Docker; the cloud project is linked in Phase 2), Vitest, ESLint and Prettier, `.env.example`, basic CI on GitHub Actions (lint, typecheck, test).
✅ `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass, and `supabase/` is initialized.

**Phase 1 — Calculation engine (no UI)**
Complete `lib/engine` for positions, cash and realized gain, with the Delta importer as a pure function.
✅ The acceptance test in section 8.3 passes with the exact numbers.

**Phase 2 — Database + auth**
Link `finance-dev` (`supabase link`), section 5 migrations applied with `supabase db push`, RLS, magic link, allowed emails list and the user isolation test.
✅ User A can't read user B's data.

**Phase 3 — Market data + crons**
`MarketDataProvider` with the Yahoo implementation, cron endpoints and backfill.
✅ After running the cron, `prices_daily` has history for every symbol in the fixture. *(Done: `pnpm test:live`.)*

**Phase 4 — Main UI**
Home, Positions, position detail, Activity (with manual entry) and CSV import with preview.
✅ Import the Delta CSV and see the numbers from section 8.3 on screen. *(Done: `lib/portfolio/__tests__/app-http.live.test.ts`.)*

**Phase 5 — Advanced metrics**
Historical series, TWR, XIRR, benchmark comparison and allocation. *(Allocation by instrument and by type has been there since Phase 4.)*
✅ TWR and XIRR tests with hand-computed cases (including a mid-period deposit). *(Done: `lib/engine/__tests__/performance.test.ts`; "Rendimiento" card on Home.)*

**Phase 6 — Watchlist + PWA**
**Prerequisite (done):** sign-in is with a **6-digit OTP code** typed into the app, with **our own SMTP** (a dedicated Gmail account with an app password). The email link opened Safari, not the installed PWA; and Supabase's default email (2 messages per hour, only to organization members) couldn't be used to invite a friend either. Details in `docs/decisions.md`. Includes an **early deploy to Vercel pointing at `finance-dev`** (the iPhone requires HTTPS to install the app); production is still Phase 7.
✅ Installable on the iPhone; it opens without the browser bar and you sign in with the code.

**Phase 7 — Deploy**
Vercel + Supabase in the cloud: create the `finance` (production) project, `supabase link` + `db push` with explicit confirmation, and load its credentials only into Vercel; crons configured and an optional domain.
✅ Works in production with your account and a friend's.

**Phase 8 (optional) — IBKR Flex Query, automatic dividends, FIFO and notifications.**

### 14.3 Suggested first prompt for Claude Code
> Read the whole PROJECT_SPEC.md. We start with Phase 0 and Phase 1. Before writing code, propose the file plan for `lib/engine` and the main types (Transaction, Position, EngineResult). Then implement the Delta importer and the calculation of positions, cash and realized gain, with Vitest tests using the fixture from section 8.3. Don't move on to the UI until the acceptance test passes.

---

## 15. Open decisions

- Store the computed historical series in a cache table (for example `portfolio_snapshots`) or recompute it on every request? Start by recomputing; cache if it gets slow.
- Average cost or FIFO by default? Start with average cost (the one Delta and My Pocket Portfolio use, which makes comparing easier) and leave FIFO as an option.
- Real multi-currency? The model supports it (`currency` on accounts and transactions), but v1 assumes USD. Add an `fx_rates` table if needed.
- Final data provider if Yahoo stops working.
- Push notifications in the iOS PWA (supported in recent iOS versions): optional, for later.

---

## 16. Definition of "done" for v1

- [ ] I import the Delta CSV and see exactly the positions, cost basis, realized gain and cash from section 8.3.
- [ ] I enter a new buy by hand and everything is recomputed (position, cash, percentages).
- [ ] I see total value, unrealized and realized gain, TWR vs. SPY and XIRR.
- [ ] I have a working watchlist.
- [ ] It is installed on my iPhone as an app and loads fast.
- [ ] A friend can use it with their own account without seeing my data.
- [ ] Monthly cost: USD 0.
