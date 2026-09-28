-- Cripto (etapa 3 de varios portafolios): monedas grandes cotizadas en USD, cargadas a mano.
--
--  1. `instruments.type` admite 'CRYPTO'. El símbolo canónico es el par de Yahoo (`BTC-USD`), no
--     `BTC`: ese es el ticker de un ETF (Grayscale Bitcoin Mini Trust) y compartirían precios.
--  2. `create_portfolio` recibe el benchmark contra el que se compara (por defecto SPY). La app solo
--     ofrece una lista corta (SPY y BTC-USD); la base exige el mismo formato que un símbolo.
--
-- Compatible hacia atrás: el CHECK solo se ensancha y el parámetro nuevo tiene valor por defecto
-- (la firma vieja se reemplaza: una llamada con solo el nombre sigue funcionando).

-- 1. Tipo CRYPTO -------------------------------------------------------------------------------------
alter table public.instruments drop constraint instruments_type_valid;
alter table public.instruments
  add constraint instruments_type_valid
  check (type is null or type in ('STOCK', 'ETF', 'CRYPTO'));

-- 2. Alta de un portafolio con su benchmark -------------------------------------------------------------
drop function public.create_portfolio(text);

create function public.create_portfolio(p_name text, p_benchmark text default 'SPY')
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_portfolio uuid;
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;

  -- El formato lo valida `portfolios_benchmark_format`.
  insert into public.portfolios (user_id, name, benchmark_symbol)
  values (v_uid, btrim(p_name), coalesce(p_benchmark, 'SPY'))
  returning id into v_portfolio;

  insert into public.accounts (user_id, portfolio_id, name)
  values (v_uid, v_portfolio, 'Cuenta principal');

  return v_portfolio;
end;
$$;

revoke execute on function public.create_portfolio(text, text) from public, anon, authenticated;
grant execute on function public.create_portfolio(text, text) to authenticated;
