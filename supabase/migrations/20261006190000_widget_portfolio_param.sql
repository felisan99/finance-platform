-- Un widget por portafolio con un solo código (docs/decisions.md, "Widget de iPhone"): cada widget
-- de Scriptable puede llevar en su campo «Parameter» el nombre de un portafolio, y `widget_ledger`
-- lo recibe como `p_portfolio_name`.
--
--  - Sin nombre (o vacío): lo que eligió el código al crearlo (un portafolio, o todos).
--  - Con nombre y un código de «Todos»: ese portafolio de la persona, sin distinguir mayúsculas ni
--    espacios en los bordes (los nombres son únicos por persona así: índice `portfolios_user_name_key`).
--  - Con nombre y un código de un solo portafolio: solo si es ese. El código limita qué expone.
--  - Si no corresponde: `{"unknown_portfolio": true}`, sin decir qué portafolios existen.
--
-- Cambia la firma: se borra y se vuelve a crear, con los mismos permisos (solo `service_role`).

drop function public.widget_ledger(text);

create function public.widget_ledger(p_token_hash text, p_portfolio_name text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit constant int := 60;
  v_window constant interval := interval '1 hour';
  v_token public.widget_tokens%rowtype;
  v_name text := nullif(btrim(p_portfolio_name), '');
  v_portfolio uuid;
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

  v_portfolio := v_token.portfolio_id;
  if v_name is not null then
    select p.id into v_portfolio
    from public.portfolios p
    where p.user_id = v_token.user_id and lower(p.name) = lower(v_name);
    if v_portfolio is null
       or (v_token.portfolio_id is not null and v_portfolio <> v_token.portfolio_id) then
      return jsonb_build_object('unknown_portfolio', true);
    end if;
  end if;

  return jsonb_build_object(
    'limited', false,
    'portfolio_id', v_portfolio,
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
        and (v_portfolio is null or p.id = v_portfolio)
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
        and (v_portfolio is null or a.portfolio_id = v_portfolio)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.widget_ledger(text, text) from public, anon, authenticated;
grant execute on function public.widget_ledger(text, text) to service_role;
