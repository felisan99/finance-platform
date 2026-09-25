-- Watchlist (spec §10.4): lectura de mercado de los símbolos seguidos y tope por lista.
--
-- Las tablas `watchlists` y `watchlist_items` ya existen (user_tables, con RLS y una lista por
-- defecto por usuario): esta migración agrega lo que falta para mostrarlas.

-- Para cada instrumento pedido, en una sola consulta y con los montos en texto (sin floats):
--  * último y penúltimo cierre (para el cambio del día cuando no hay cotización del proveedor);
--  * mínimo y máximo de los CIERRES desde `p_since` (rango de 52 semanas; no son extremos
--    intradiarios: `prices_daily` guarda solo cierres);
--  * los últimos `p_points` cierres, de más viejo a más nuevo, como `[[fecha, cierre], …]` (el
--    minigráfico). Una fila por instrumento: no choca con el corte de 1000 filas de PostgREST.
-- Es `security invoker`: RLS de `prices_daily` sigue rigiendo. Los instrumentos sin ningún cierre
-- no devuelven fila.
create or replace function public.watchlist_market(
  p_instrument_ids uuid[],
  p_since date,
  p_points int
)
returns table (
  instrument_id uuid,
  last_close text,
  last_date date,
  prev_close text,
  prev_date date,
  low_close text,
  high_close text,
  recent jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_instrument_ids is null or cardinality(p_instrument_ids) > 100 then
    raise exception 'cantidad de instrumentos inválida (máximo 100)' using errcode = '22023';
  end if;
  if p_since is null or p_points is null or p_points < 2 or p_points > 400 then
    raise exception 'parámetros inválidos' using errcode = '22023';
  end if;

  return query
  select
    d.id,
    l.last_close,
    l.last_date,
    l.prev_close,
    l.prev_date,
    w.low_close,
    w.high_close,
    w.recent
  from unnest(p_instrument_ids) as d(id)
  cross join lateral (
    select
      (array_agg(x.close::text order by x.date desc))[1] as last_close,
      (array_agg(x.date order by x.date desc))[1] as last_date,
      (array_agg(x.close::text order by x.date desc))[2] as prev_close,
      (array_agg(x.date order by x.date desc))[2] as prev_date
    from (
      select p.close, p.date
      from public.prices_daily p
      where p.instrument_id = d.id
      order by p.date desc
      limit 2
    ) x
  ) l
  cross join lateral (
    select
      min(y.close)::text as low_close,
      max(y.close)::text as high_close,
      (
        select jsonb_agg(jsonb_build_array(z.date, z.close::text) order by z.date)
        from (
          select q.date, q.close
          from public.prices_daily q
          where q.instrument_id = d.id
          order by q.date desc
          limit p_points
        ) z
      ) as recent
    from public.prices_daily y
    where y.instrument_id = d.id
      and y.date >= p_since
  ) w
  where l.last_close is not null;
end;
$$;

revoke execute on function public.watchlist_market(uuid[], date, int) from public, anon;
grant execute on function public.watchlist_market(uuid[], date, int) to authenticated;

-- Tope de símbolos por watchlist. La acción ya lo valida; esto es la defensa en la base. El
-- candado por lista evita que dos altas simultáneas se salteen el conteo.
create function public.watchlist_items_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.watchlist_id = old.watchlist_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.watchlist_id::text, 0));

  if (
    select count(*) from public.watchlist_items w where w.watchlist_id = new.watchlist_id
  ) >= 50 then
    raise exception 'la watchlist admite hasta 50 símbolos' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.watchlist_items_limit() from public, anon, authenticated;

create trigger watchlist_items_limit
  before insert or update of watchlist_id on public.watchlist_items
  for each row execute function public.watchlist_items_limit();
