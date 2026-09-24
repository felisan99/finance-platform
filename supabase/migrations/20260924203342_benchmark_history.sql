-- Fase 5 (métricas): el benchmark de un portafolio (`portfolios.benchmark_symbol`, SPY por defecto)
-- tiene que existir como instrumento y los jobs de precios tienen que mantener su historial, porque
-- TWR vs. benchmark (spec §6.5) lo necesita desde la primera transacción del portafolio.

-- 1. El benchmark por defecto es un dato de referencia y existe en todos los entornos.
insert into public.instruments (symbol, name, type, exchange)
values ('SPY', 'SPDR S&P 500 ETF Trust', 'ETF', 'NYSE Arca')
on conflict (symbol) do nothing;

-- 2. `active_instruments()` (misma firma) suma los instrumentos que son el benchmark de un
--    portafolio con al menos una transacción. Su `first_tx_date` es la primera transacción del
--    portafolio (la más antigua entre esa y la propia del instrumento, si también lo tiene:
--    `least` ignora los nulos). Sigue `security invoker` y solo la ejecuta `service_role`.
create or replace function public.active_instruments()
returns table (
  instrument_id uuid,
  symbol text,
  provider_symbol text,
  history_backfilled_at timestamptz,
  history_from date,
  first_tx_date date,
  in_watchlist boolean,
  latest_price_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with used as (
    select t.instrument_id, min(t.executed_at at time zone 'UTC')::date as first_tx_date
    from public.transactions t
    where t.instrument_id is not null
    group by t.instrument_id
  ),
  watched as (
    select distinct w.instrument_id
    from public.watchlist_items w
  ),
  bench as (
    select i.id as instrument_id, min(t.executed_at at time zone 'UTC')::date as first_tx_date
    from public.portfolios pf
    join public.instruments i on i.symbol = pf.benchmark_symbol
    join public.accounts a on a.portfolio_id = pf.id
    join public.transactions t on t.account_id = a.id
    group by i.id
  )
  select
    i.id,
    i.symbol,
    i.provider_symbol,
    i.history_backfilled_at,
    i.history_from,
    least(u.first_tx_date, b.first_tx_date),
    (w.instrument_id is not null),
    (select max(p.date) from public.prices_daily p where p.instrument_id = i.id)
  from public.instruments i
  left join used u on u.instrument_id = i.id
  left join watched w on w.instrument_id = i.id
  left join bench b on b.instrument_id = i.id
  where u.instrument_id is not null
     or w.instrument_id is not null
     or b.instrument_id is not null
  order by i.symbol;
$$;

revoke execute on function public.active_instruments() from public, anon, authenticated;
grant execute on function public.active_instruments() to service_role;
