-- Tablas de usuario (spec §5.1). Cada fila pertenece a un usuario (`user_id`) y RLS
-- (migración rls_and_grants) limita el acceso a sus propias filas.
--
-- Diferencias con el SQL del spec (ver docs/decisions.md):
--  * FK compuestas (hijo, user_id) -> (padre, user_id): un usuario no puede colgar sus filas
--    de la cuenta o el portafolio de otro (el chequeo de una FK simple ignora RLS).
--  * transactions.seq: desempate estable para operaciones con el mismo instante.
--  * CHECK por tipo de transacción, que refleja la unión discriminada del motor.
--  * imports.account_id pasa a NULL al borrar la cuenta, en vez de impedir el borrado.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  base_currency text not null default 'USD',
  created_at timestamptz not null default now(),
  constraint profiles_base_currency_format check (base_currency ~ '^[A-Z]{3}$')
);

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  benchmark_symbol text not null default 'SPY',
  created_at timestamptz not null default now(),
  constraint portfolios_id_user_key unique (id, user_id),
  constraint portfolios_name_not_blank check (btrim(name) <> ''),
  constraint portfolios_benchmark_format check (benchmark_symbol ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$')
);
create index portfolios_user_id_idx on public.portfolios (user_id);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  portfolio_id uuid not null,
  name text not null,                   -- ej. "IBKR"
  currency text not null default 'USD',
  cost_method text not null default 'AVERAGE',
  created_at timestamptz not null default now(),
  constraint accounts_id_user_key unique (id, user_id),
  constraint accounts_portfolio_fk foreign key (portfolio_id, user_id)
    references public.portfolios (id, user_id) on delete cascade,
  constraint accounts_cost_method_valid check (cost_method in ('AVERAGE', 'FIFO')),
  constraint accounts_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint accounts_name_not_blank check (btrim(name) <> '')
);
create index accounts_user_id_idx on public.accounts (user_id);
create index accounts_portfolio_id_idx on public.accounts (portfolio_id);

create type public.tx_type as enum (
  'BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'INTEREST', 'SPLIT', 'TAX'
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid not null,
  type public.tx_type not null,
  instrument_id uuid references public.instruments,  -- null para DEPOSIT/WITHDRAWAL/FEE/INTEREST de la cuenta
  executed_at timestamptz not null,
  quantity numeric(20,8),                            -- acciones (fraccionarias permitidas)
  price numeric(20,8),                               -- precio unitario SIN comisión
  amount numeric(20,4),                              -- monto en efectivo (dividendos, depósitos, etc.)
  fee numeric(20,4) not null default 0,
  currency text not null default 'USD',
  split_ratio numeric(20,8),                         -- para SPLIT: nuevas/viejas (ej. 10 para 10:1)
  notes text,
  source text not null default 'manual',             -- 'manual' | 'delta_csv' | 'ibkr_flex'
  external_id text,                                  -- para deduplicar importaciones
  created_at timestamptz not null default now(),
  -- Todas las filas de una importación comparten created_at (now()); seq mantiene el orden de inserción.
  seq bigint generated always as identity,
  constraint transactions_account_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade,
  constraint transactions_dedup unique (account_id, source, external_id),
  constraint transactions_source_valid check (source in ('manual', 'delta_csv', 'ibkr_flex')),
  constraint transactions_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint transactions_fee_only_trades check (type in ('BUY', 'SELL') or fee = 0),
  -- `is true`: un NULL (campo faltante) no debe pasar el chequeo.
  constraint transactions_shape check (
    (
      case
        when type in ('BUY', 'SELL') then
          instrument_id is not null and quantity > 0 and price >= 0 and fee >= 0
        when type = 'DIVIDEND' then instrument_id is not null and amount > 0
        when type = 'SPLIT' then instrument_id is not null and split_ratio > 0
        when type in ('DEPOSIT', 'WITHDRAWAL', 'FEE', 'TAX') then amount > 0
        when type = 'INTEREST' then amount is not null and amount <> 0  -- puede ser negativo (interés de margen)
      end
    ) is true
  )
);
create index transactions_user_id_idx on public.transactions (user_id);
create index transactions_account_order_idx
  on public.transactions (account_id, executed_at, created_at, seq);
create index transactions_instrument_id_idx on public.transactions (instrument_id);

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'Watchlist',
  constraint watchlists_id_user_key unique (id, user_id)
);
create index watchlists_user_id_idx on public.watchlists (user_id);

create table public.watchlist_items (
  watchlist_id uuid not null,
  instrument_id uuid not null references public.instruments,
  user_id uuid not null references auth.users on delete cascade,
  added_at timestamptz not null default now(),
  primary key (watchlist_id, instrument_id),
  constraint watchlist_items_watchlist_fk foreign key (watchlist_id, user_id)
    references public.watchlists (id, user_id) on delete cascade
);
create index watchlist_items_user_id_idx on public.watchlist_items (user_id);
create index watchlist_items_instrument_id_idx on public.watchlist_items (instrument_id);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid,
  source text not null,
  filename text,
  rows_total int,
  rows_imported int,
  rows_skipped int,
  report jsonb,                                      -- errores y advertencias por fila
  created_at timestamptz not null default now(),
  -- Al borrar la cuenta se conserva el historial de importaciones, sin cuenta asociada.
  constraint imports_account_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete set null (account_id),
  constraint imports_source_valid check (source in ('delta_csv', 'ibkr_flex'))
);
create index imports_user_id_idx on public.imports (user_id, created_at desc);
