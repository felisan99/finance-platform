-- Soporte de las pantallas de la Fase 4: límites de uso por usuario, importación atómica de
-- transacciones y lectura de precios por instrumento.
-- Regla del proyecto: toda tabla nueva lleva su RLS y sus GRANT.

-- 1. Límites de uso por usuario ----------------------------------------------------------------
-- En serverless la memoria del servidor no sirve para limitar el uso (cada invocación puede
-- correr en una instancia distinta): el contador vive en la base. Ventana fija por (usuario, clave).
create table public.rate_limits (
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  window_start timestamptz not null default now(),
  count int not null default 0,
  primary key (user_id, key),
  constraint rate_limits_key_format check (key ~ '^[a-z][a-z0-9_]{0,39}$')
);

-- Sin políticas ni permisos para anon/authenticated: si un usuario pudiera escribir su propio
-- contador podría reiniciarlo. Solo se toca a través de `take_rate_limit`.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;

-- Cuenta un uso de `p_key` para el usuario actual y devuelve si todavía está dentro del límite
-- (`p_limit` usos por ventana de `p_window_seconds`). Un uso rechazado también cuenta. `security
-- definer` porque la tabla no es accesible para el usuario; la identidad sale de `auth.uid()`, no
-- de un parámetro, así que nadie puede consumir ni consultar el contador de otro.
create or replace function public.take_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    return false;
  end if;
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'clave de límite inválida' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'límite inválido' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'ventana inválida' using errcode = '22023';
  end if;

  insert into public.rate_limits as r (user_id, key, window_start, count)
  values (v_uid, p_key, now(), 1)
  on conflict (user_id, key) do update
    set window_start = case
          when r.window_start <= now() - make_interval(secs => p_window_seconds) then now()
          else r.window_start
        end,
        count = case
          when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1
          else r.count + 1
        end
  returning r.count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.take_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.take_rate_limit(text, int, int) to authenticated;

-- 2. Importación atómica de transacciones (spec §8.2) ------------------------------------------
-- supabase-js no abre transacciones de varias sentencias: una función Postgres sí (una llamada =
-- una transacción). Si una fila viola un CHECK, no queda nada, ni siquiera la fila de `imports`.
--
-- `security invoker`: corre con los permisos del usuario, así que RLS y las FK compuestas siguen
-- protegiendo (no se puede importar a la cuenta de otro). Los instrumentos ya tienen que existir:
-- el servidor los da de alta antes con la clave secreta (los usuarios no escriben `instruments`).
--
-- `p_rows` es un arreglo de objetos {type, symbol, executed_at, quantity, price, amount, fee,
-- currency, split_ratio, notes, external_id}; los montos viajan como strings decimales. El orden
-- del arreglo es el orden de inserción (`seq`), que desempata operaciones del mismo instante.
create or replace function public.import_transactions(
  p_account_id uuid,
  p_source text,
  p_filename text,
  p_rows jsonb,
  p_report jsonb
)
returns table (import_id uuid, inserted int, duplicates int)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_total int;
  v_inserted int;
  v_import uuid;
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;
  if p_source is null or p_source not in ('delta_csv', 'ibkr_flex') then
    raise exception 'origen de importación inválido' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows debe ser un arreglo' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 5000 then
    raise exception 'cantidad de filas inválida (1 a 5000)' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.accounts a where a.id = p_account_id and a.user_id = v_uid
  ) then
    raise exception 'cuenta inexistente' using errcode = '42501';
  end if;

  insert into public.imports (user_id, account_id, source, filename, rows_total, report)
  values (v_uid, p_account_id, p_source, left(p_filename, 200), v_total, p_report)
  returning id into v_import;

  with src as (
    select *
    from rows from (
      jsonb_to_recordset(p_rows) as (
        type public.tx_type,
        symbol text,
        executed_at timestamptz,
        quantity numeric,
        price numeric,
        amount numeric,
        fee numeric,
        currency text,
        split_ratio numeric,
        notes text,
        external_id text
      )
    ) with ordinality as x(
      type, symbol, executed_at, quantity, price, amount, fee, currency, split_ratio, notes,
      external_id, ord
    )
  ),
  ins as (
    insert into public.transactions (
      user_id, account_id, type, instrument_id, executed_at, quantity, price, amount, fee,
      currency, split_ratio, notes, source, external_id
    )
    select
      v_uid, p_account_id, r.type, i.id, r.executed_at, r.quantity, r.price, r.amount,
      coalesce(r.fee, 0), coalesce(r.currency, 'USD'), r.split_ratio, r.notes, p_source, r.external_id
    from src r
    left join public.instruments i on i.symbol = r.symbol
    order by r.ord
    on conflict (account_id, source, external_id) do nothing
    returning 1
  )
  select count(*)::int into v_inserted from ins;

  -- rows_* cuentan las filas enviadas; el detalle del archivo (omitidas, errores) va en `report`.
  update public.imports
  set rows_imported = v_inserted, rows_skipped = v_total - v_inserted
  where id = v_import;

  return query select v_import, v_inserted, v_total - v_inserted;
end;
$$;

revoke execute on function public.import_transactions(uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_transactions(uuid, text, text, jsonb, jsonb)
  to authenticated;

-- 3. Últimos precios por instrumento -----------------------------------------------------------
-- Último y penúltimo cierre de cada instrumento pedido (para valuar y calcular el cambio del día)
-- en una sola consulta, con los montos en texto (sin pasar por floats). Usa el índice de la clave
-- primaria de prices_daily una vez por instrumento.
create or replace function public.instrument_prices(p_instrument_ids uuid[])
returns table (
  instrument_id uuid,
  last_close text,
  last_date date,
  prev_close text,
  prev_date date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_instrument_ids is null or cardinality(p_instrument_ids) > 500 then
    raise exception 'cantidad de instrumentos inválida (máximo 500)' using errcode = '22023';
  end if;

  return query
  select
    d.id,
    (array_agg(x.close::text order by x.date desc))[1],
    (array_agg(x.date order by x.date desc))[1],
    (array_agg(x.close::text order by x.date desc))[2],
    (array_agg(x.date order by x.date desc))[2]
  from unnest(p_instrument_ids) as d(id)
  cross join lateral (
    select p.close, p.date
    from public.prices_daily p
    where p.instrument_id = d.id
    order by p.date desc
    limit 2
  ) x
  group by d.id;
end;
$$;

revoke execute on function public.instrument_prices(uuid[]) from public, anon;
grant execute on function public.instrument_prices(uuid[]) to authenticated;
