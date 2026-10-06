-- Widget de iPhone (Scriptable): un código personal de solo lectura para ver el resumen del
-- portafolio sin sesión (docs/decisions.md, "Widget de iPhone").
--
-- El widget no puede usar el ingreso con código del correo ni las cookies de la app: manda un
-- token propio a `/api/widget`. En la base se guarda solo su SHA-256. Un token por persona: crear
-- otro reemplaza al anterior. Sirve únicamente para leer el resumen; no es un ingreso.
--
--  1. `widget_tokens`: la persona ve (sin el hash) y borra el suyo; no lo escribe directamente.
--  2. `create_widget_token`: alta o reemplazo, con la sesión de la persona.
--  3. `widget_ledger`: lo que necesita el endpoint para calcular el resumen. Solo `service_role`:
--     si la pudiera llamar `anon`, un token filtrado dejaría leer todo el libro por PostgREST; así
--     el único camino es el endpoint, que devuelve solo el resumen. El alcance (de quién son los
--     datos) lo fija esta función a partir del token, no quien llama.

-- 1. Tabla ----------------------------------------------------------------------------------------
create table public.widget_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  token_hash text not null unique,
  -- `null` = todos los portafolios («Todo junto»). Si se borra el portafolio, el token muere con
  -- él: no pasa a mostrar todo.
  portfolio_id uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Límite de uso por token (ventana fija), como `take_rate_limit`.
  window_start timestamptz not null default now(),
  window_count int not null default 0,
  constraint widget_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint widget_tokens_portfolio_fk foreign key (portfolio_id, user_id)
    references public.portfolios (id, user_id) on delete cascade
);
create index widget_tokens_portfolio_id_idx on public.widget_tokens (portfolio_id);

alter table public.widget_tokens enable row level security;
revoke all on public.widget_tokens from anon, authenticated;
-- Nunca `token_hash` ni el contador: solo lo que muestra la pantalla.
grant select (user_id, portfolio_id, created_at, last_used_at) on public.widget_tokens
  to authenticated;
grant delete on public.widget_tokens to authenticated;
grant select, insert, update, delete on public.widget_tokens to service_role;

create policy widget_tokens_select on public.widget_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy widget_tokens_delete on public.widget_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- 2. Alta o reemplazo -----------------------------------------------------------------------------
-- `security definer` porque la persona no escribe la tabla directamente (no puede tocar el
-- contador ni elegir otro `user_id`). El portafolio tiene que ser suyo.
create or replace function public.create_widget_token(p_token_hash text, p_portfolio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token inválido' using errcode = '22023';
  end if;
  if p_portfolio_id is not null and not exists (
    select 1 from public.portfolios p where p.id = p_portfolio_id and p.user_id = v_uid
  ) then
    raise exception 'portafolio inválido' using errcode = '22023';
  end if;

  insert into public.widget_tokens as w (user_id, token_hash, portfolio_id)
  values (v_uid, p_token_hash, p_portfolio_id)
  on conflict (user_id) do update
    set token_hash = excluded.token_hash,
        portfolio_id = excluded.portfolio_id,
        created_at = now(),
        last_used_at = null,
        window_start = now(),
        window_count = 0;
end;
$$;

revoke execute on function public.create_widget_token(text, uuid) from public, anon, authenticated;
grant execute on function public.create_widget_token(text, uuid) to authenticated;

-- 3. Lo que lee el endpoint ------------------------------------------------------------------------
-- Cuenta un uso y devuelve los portafolios (con sus cuentas, como `listPortfolios`) y las
-- transacciones (las columnas de `TRANSACTION_COLUMNS`, con los `numeric` como texto) del dueño del
-- token, limitado a su portafolio si eligió uno. `null` si el token no existe;
-- `{"limited": true}` pasados 60 usos en una hora. Un solo jsonb: no lo corta el límite de filas
-- de PostgREST.
create or replace function public.widget_ledger(p_token_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit constant int := 60;
  v_window constant interval := interval '1 hour';
  v_token public.widget_tokens%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  update public.widget_tokens w
    set window_start = case when w.window_start <= now() - v_window then now() else w.window_start end,
        window_count = case when w.window_start <= now() - v_window then 1 else w.window_count + 1 end,
        last_used_at = now()
  where w.token_hash = p_token_hash
  returning * into v_token;

  if not found then
    return null;
  end if;
  if v_token.window_count > v_limit then
    return jsonb_build_object('limited', true);
  end if;

  return jsonb_build_object(
    'limited', false,
    'portfolio_id', v_token.portfolio_id,
    'portfolio_count', (
      select count(*) from public.portfolios p where p.user_id = v_token.user_id
    ),
    'portfolios', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'benchmark_symbol', p.benchmark_symbol,
          'accounts', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', a.id,
                'name', a.name,
                'currency', a.currency,
                'cost_method', a.cost_method
              )
              order by a.created_at, a.id
            )
            from public.accounts a
            where a.portfolio_id = p.id and a.user_id = v_token.user_id
          ), '[]'::jsonb)
        )
        order by p.created_at, p.id
      )
      from public.portfolios p
      where p.user_id = v_token.user_id
        and (v_token.portfolio_id is null or p.id = v_token.portfolio_id)
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'account_id', t.account_id,
          'type', t.type,
          'instrument_id', t.instrument_id,
          'executed_at', t.executed_at,
          'quantity', t.quantity::text,
          'price', t.price::text,
          'amount', t.amount::text,
          'fee', t.fee::text,
          'currency', t.currency,
          'split_ratio', t.split_ratio::text,
          'notes', t.notes,
          'source', t.source,
          'external_id', t.external_id,
          'created_at', t.created_at,
          'seq', t.seq
        )
        order by t.executed_at, t.created_at, t.seq
      )
      from public.transactions t
      join public.accounts a on a.id = t.account_id and a.user_id = v_token.user_id
      where t.user_id = v_token.user_id
        and (v_token.portfolio_id is null or a.portfolio_id = v_token.portfolio_id)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.widget_ledger(text) from public, anon, authenticated;
grant execute on function public.widget_ledger(text) to service_role;
