-- Series de cierres de varios instrumentos en UNA llamada (rendimiento de Inicio y «Antes de
-- comprar»). Antes se leía `prices_daily` con una consulta por instrumento y, como PostgREST corta
-- en 1000 filas, dos o más por cada uno con más de ~4 años: con 30 instrumentos eran unas 60
-- consultas por pantalla.
--
-- Una fila por instrumento pedido que tenga cierres desde `p_from`, con las fechas y los valores
-- en dos arreglos paralelos ordenados por fecha. Los montos van en texto (sin floats). Con
-- `p_adjusted`, el cierre ajustado por dividendos (`adj_close`) y solo los días que lo tienen.
-- Es `security invoker`: RLS de `prices_daily` sigue rigiendo.
create function public.price_series(
  p_instrument_ids uuid[],
  p_from date,
  p_adjusted boolean
)
returns table (
  instrument_id uuid,
  dates date[],
  closes text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_instrument_ids is null or cardinality(p_instrument_ids) > 50 then
    raise exception 'cantidad de instrumentos inválida (máximo 50)' using errcode = '22023';
  end if;
  if p_from is null or p_adjusted is null then
    raise exception 'parámetros inválidos' using errcode = '22023';
  end if;

  return query
  select
    p.instrument_id,
    array_agg(p.date order by p.date),
    array_agg(
      (case when p_adjusted then p.adj_close else p.close end)::text
      order by p.date
    )
  from public.prices_daily p
  where p.instrument_id = any (p_instrument_ids)
    and p.date >= p_from
    and (not p_adjusted or p.adj_close is not null)
  group by p.instrument_id;
end;
$$;

revoke execute on function public.price_series(uuid[], date, boolean) from public, anon;
grant execute on function public.price_series(uuid[], date, boolean) to authenticated;
