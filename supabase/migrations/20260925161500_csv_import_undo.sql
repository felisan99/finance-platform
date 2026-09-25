-- Importación de CSV: formato simple propio y «Deshacer importación».
--
--  1. Cada transacción importada queda ligada a su importación (`transactions.import_id`), para
--     poder deshacer una importación entera. Las importaciones anteriores a esta migración quedan
--     con `import_id` nulo: no se pueden deshacer (se muestran así).
--  2. Nuevo origen `csv` (el formato simple, el mismo del «Exportar CSV») en los CHECK de `source`.
--  3. `import_transactions` acepta `csv` y guarda el `import_id`.
--  4. `undo_import` borra las transacciones de una importación; `recent_imports` las lista.
--
-- Es aditiva y compatible hacia atrás: la columna es nula por defecto y los CHECK solo se ensanchan,
-- así que el código anterior sigue funcionando hasta que se despliegue el nuevo.

-- 1. Ligar transacciones e importaciones --------------------------------------------------------
alter table public.imports add column undone_at timestamptz;

-- FK compuestas (hijo, user_id) -> (padre, user_id): un usuario no puede colgar una transacción
-- propia de la importación de otro (el chequeo de una FK ignora RLS). Ver docs/decisions.md.
alter table public.imports
  add constraint imports_id_user_key unique (id, user_id);

alter table public.transactions add column import_id uuid;
alter table public.transactions
  add constraint transactions_import_fk foreign key (import_id, user_id)
    references public.imports (id, user_id) on delete set null (import_id);
create index transactions_import_id_idx
  on public.transactions (import_id) where import_id is not null;

-- 2. Nuevo origen `csv` --------------------------------------------------------------------------
alter table public.transactions drop constraint transactions_source_valid;
alter table public.transactions
  add constraint transactions_source_valid
  check (source in ('manual', 'delta_csv', 'ibkr_flex', 'csv'));

alter table public.imports drop constraint imports_source_valid;
alter table public.imports
  add constraint imports_source_valid
  check (source in ('delta_csv', 'ibkr_flex', 'csv'));

-- 3. Importación atómica: ahora con `csv` y con `import_id` --------------------------------------
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
  if p_source is null or p_source not in ('delta_csv', 'ibkr_flex', 'csv') then
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
      currency, split_ratio, notes, source, external_id, import_id
    )
    select
      v_uid, p_account_id, r.type, i.id, r.executed_at, r.quantity, r.price, r.amount,
      coalesce(r.fee, 0), coalesce(r.currency, 'USD'), r.split_ratio, r.notes, p_source,
      r.external_id, v_import
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

-- 4a. Deshacer una importación ---------------------------------------------------------------------
-- Borra las transacciones que quedaron ligadas a `p_import_id` y marca la importación como
-- deshecha. `security invoker`: RLS deja borrar solo las propias (el `user_id` de abajo es una
-- segunda barrera). Devuelve cuántas borró. Que el libro siga siendo consistente (por ejemplo, que
-- no quede una venta sin su compra) lo valida antes el servidor con `validateLedgerChange`.
create or replace function public.undo_import(p_import_id uuid)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted int;
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '28000';
  end if;
  if p_import_id is null or not exists (
    select 1 from public.imports i
    where i.id = p_import_id and i.user_id = v_uid and i.undone_at is null
  ) then
    raise exception 'importación inexistente o ya deshecha' using errcode = '22023';
  end if;

  with del as (
    delete from public.transactions t
    where t.import_id = p_import_id and t.user_id = v_uid
    returning 1
  )
  select count(*)::int into v_deleted from del;

  update public.imports
  set undone_at = now()
  where id = p_import_id and user_id = v_uid;

  return v_deleted;
end;
$$;

revoke execute on function public.undo_import(uuid) from public, anon, authenticated;
grant execute on function public.undo_import(uuid) to authenticated;

-- 4b. Últimas importaciones, con cuántas transacciones quedan hoy ligadas a cada una --------------
create or replace function public.recent_imports(p_limit int default 10)
returns table (
  import_id uuid,
  source text,
  filename text,
  created_at timestamptz,
  rows_imported int,
  undone_at timestamptz,
  live_count int
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'p_limit inválido (1 a 50)' using errcode = '22023';
  end if;

  return query
  select
    i.id,
    i.source,
    i.filename,
    i.created_at,
    i.rows_imported,
    i.undone_at,
    (select count(*)::int from public.transactions t where t.import_id = i.id)
  from public.imports i
  order by i.created_at desc
  limit p_limit;
end;
$$;

revoke execute on function public.recent_imports(int) from public, anon, authenticated;
grant execute on function public.recent_imports(int) to authenticated;
