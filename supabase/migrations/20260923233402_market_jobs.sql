-- Soporte de los jobs de datos de mercado (Fase 3, spec §7.2).
-- Todo lo que se agrega acá lo usa solo el servidor con la clave secreta (service_role).

-- 1. Desde qué fecha se pidió el último backfill de un instrumento. Distingue "el historial
--    empieza tarde porque la acción salió a bolsa después" de "falta historial anterior":
--    si una transacción nueva es anterior a `history_from`, el job extiende el backfill hacia atrás.
alter table public.instruments add column history_from date;

-- 2. Registro durable de las corridas de los crons. Los logs de runtime de Vercel Hobby duran
--    1 hora y Yahoo no es una API oficial: sin esto, un cron que falla en silencio no se ve.
create table public.market_job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  summary jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  constraint market_job_runs_job_valid check (job in ('daily-prices', 'backfill')),
  constraint market_job_runs_status_valid check (status in ('running', 'ok', 'partial', 'error')),
  -- Una corrida sin terminar es exactamente una que sigue 'running'.
  constraint market_job_runs_finished_consistent check ((status = 'running') = (finished_at is null))
);

create index market_job_runs_started_at_idx on public.market_job_runs (started_at desc);

-- Regla del proyecto: toda tabla nueva lleva su RLS y sus GRANT. Sin políticas ni permisos para
-- anon/authenticated: solo el servidor (service_role, que salta RLS) la lee y la escribe.
alter table public.market_job_runs enable row level security;
revoke all on public.market_job_runs from anon, authenticated;
grant select, insert, update, delete on public.market_job_runs to service_role;

-- 3. Instrumentos que los jobs tienen que mantener: los que tienen alguna transacción o están en
--    alguna watchlist (de cualquier usuario). Es una función y no una consulta de la app porque
--    PostgREST corta las respuestas en 1000 filas y no ofrece `distinct`.
--    `security invoker` + sin EXECUTE para anon/authenticated: si un usuario la llamara igual,
--    RLS le mostraría solo lo suyo.
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
  )
  select
    i.id,
    i.symbol,
    i.provider_symbol,
    i.history_backfilled_at,
    i.history_from,
    u.first_tx_date,
    (w.instrument_id is not null),
    (select max(p.date) from public.prices_daily p where p.instrument_id = i.id)
  from public.instruments i
  left join used u on u.instrument_id = i.id
  left join watched w on w.instrument_id = i.id
  where u.instrument_id is not null or w.instrument_id is not null
  order by i.symbol;
$$;

revoke execute on function public.active_instruments() from public, anon, authenticated;
grant execute on function public.active_instruments() to service_role;
