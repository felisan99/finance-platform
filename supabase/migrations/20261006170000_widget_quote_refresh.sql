-- El widget de iPhone actualiza cotizaciones a demanda (docs/decisions.md, "Widget de iPhone"):
-- cuando lo consultan, pide a Yahoo solo los símbolos de sus posiciones cuya cotización se pidió hace
-- más de 2 horas. El cron de Vercel no puede correr más de una vez por día (plan Hobby).
--
--  1. `quotes_latest.fetched_at`: cuándo la pedimos nosotros. `as_of` es la hora del mercado (un
--     fin de semana sigue diciendo «viernes») y no sirve para saber si ya preguntamos hace poco. Lo
--     pone un trigger, así cuenta igual para el cron, «Actualizar precios» y el widget.
--  2. `take_widget_quote_refresh`: un intento por código cada 10 minutos. Si Yahoo falla, la
--     cotización sigue vieja; sin este freno, cada consulta del widget volvería a intentar.

-- 1. Cuándo se pidió cada cotización ------------------------------------------------------------------
-- Las filas que ya existen quedan en `null`: cuentan como viejas y se piden la primera vez.
alter table public.quotes_latest add column fetched_at timestamptz;

create or replace function public.quotes_latest_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.fetched_at := now();
  return new;
end;
$$;

revoke execute on function public.quotes_latest_touch() from public, anon, authenticated;

create trigger quotes_latest_touch
  before insert or update on public.quotes_latest
  for each row execute function public.quotes_latest_touch();

-- 2. Un intento por código cada 10 minutos --------------------------------------------------------
-- Columna sin GRANT para `authenticated` (los permisos de `widget_tokens` son por columna).
alter table public.widget_tokens add column quotes_attempted_at timestamptz;

-- `true` si este código puede intentar ahora (y lo anota); `false` si intentó hace menos de 10
-- minutos o el código no existe.
create or replace function public.take_widget_quote_refresh(p_token_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update public.widget_tokens w
    set quotes_attempted_at = now()
  where w.token_hash = p_token_hash
    and (w.quotes_attempted_at is null or w.quotes_attempted_at <= now() - interval '10 minutes');
  return found;
end;
$$;

revoke execute on function public.take_widget_quote_refresh(text) from public, anon, authenticated;
grant execute on function public.take_widget_quote_refresh(text) to service_role;
