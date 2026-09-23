-- Tablas de mercado, compartidas entre usuarios (spec §5.2).
-- Se guardan una sola vez y las actualiza el cron con la clave secreta (service_role).
-- La seguridad (RLS y GRANT) va en la migración rls_and_grants.

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,          -- símbolo canónico, ej. 'VOO', 'BRK-B'
  name text,
  type text,                            -- 'STOCK' | 'ETF'
  exchange text,
  currency text not null default 'USD',
  sector text,
  industry text,
  provider_symbol text,                 -- símbolo en el proveedor, si difiere
  history_backfilled_at timestamptz,
  created_at timestamptz not null default now(),
  -- Mismo formato que produce el importador de Delta (mayúsculas, "-" para clases de acciones).
  constraint instruments_symbol_format check (symbol ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  constraint instruments_type_valid check (type is null or type in ('STOCK', 'ETF')),
  constraint instruments_currency_format check (currency ~ '^[A-Z]{3}$')
);

create table public.prices_daily (
  instrument_id uuid not null references public.instruments on delete cascade,
  date date not null,
  close numeric(20,6) not null,
  adj_close numeric(20,6),
  primary key (instrument_id, date)
);

create table public.quotes_latest (
  instrument_id uuid primary key references public.instruments on delete cascade,
  price numeric(20,6) not null,
  change numeric(20,6),
  change_pct numeric(10,6),
  as_of timestamptz not null
);

-- Splits y dividendos detectados desde el proveedor.
create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments on delete cascade,
  type text not null,                   -- 'SPLIT' | 'DIVIDEND'
  ex_date date not null,
  ratio numeric(20,8),
  amount numeric(20,6),
  constraint corporate_actions_unique unique (instrument_id, type, ex_date),
  constraint corporate_actions_type_valid check (type in ('SPLIT', 'DIVIDEND')),
  -- `is true`: un NULL no debe pasar el chequeo.
  constraint corporate_actions_shape check (
    (
      case type
        when 'SPLIT' then ratio > 0
        when 'DIVIDEND' then amount > 0
      end
    ) is true
  )
);
