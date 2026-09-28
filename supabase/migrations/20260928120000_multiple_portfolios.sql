-- Varios portafolios por persona (por ejemplo, uno de acciones y otro de cripto).
--
-- Cada portafolio tiene exactamente una cuenta (la app no muestra cuentas): el costo promedio y el
-- libro siguen siendo por cuenta, así que un mismo símbolo en dos portafolios no se mezcla.
--
--  1. Nombres: sin espacios en los bordes, hasta 40 caracteres y únicos por persona (sin distinguir
--     mayúsculas), para que el selector no muestre dos iguales.
--  2. Entre 1 y 5 portafolios por persona. El mínimo no aplica cuando se borra la persona entera.
--  3. `create_portfolio`: crea el portafolio y su cuenta en una sola transacción.
--  4. `recent_imports` dice de qué portafolio es cada importación.
--
-- Es compatible hacia atrás: los portafolios existentes ("Portafolio principal") cumplen todo.

-- 1. Nombres ---------------------------------------------------------------------------------------
alter table public.portfolios
  add constraint portfolios_name_trimmed check (name = btrim(name)),
  add constraint portfolios_name_length check (char_length(name) <= 40);
create unique index portfolios_user_name_key
  on public.portfolios (user_id, lower(name));

-- 2. Entre 1 y 5 por persona -------------------------------------------------------------------------
-- Los códigos de error propios (`MP001`, `MP002`) los reconoce la app para dar un mensaje claro.
create or replace function public.portfolios_check_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Serializa las altas de una misma persona: dos altas simultáneas no pueden pasar las dos el tope.
  perform pg_advisory_xact_lock(hashtextextended('portfolios:' || new.user_id::text, 0));
  if (select count(*) from public.portfolios p where p.user_id = new.user_id) >= 5 then
    raise exception 'máximo 5 portafolios por persona' using errcode = 'MP001';
  end if;
  return new;
end;
$$;

revoke execute on function public.portfolios_check_limit() from public, anon, authenticated;

create trigger portfolios_check_limit
  before insert on public.portfolios
  for each row execute function public.portfolios_check_limit();

-- No se puede borrar el último portafolio de una persona: la app siempre necesita uno. Al borrar la
-- persona, la cascada borra sus portafolios cuando la fila de `auth.users` ya no existe, así que ahí
-- no se bloquea. `security definer` solo para poder mirar `auth.users`.
create or replace function public.portfolios_keep_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('portfolios:' || old.user_id::text, 0));
  if exists (select 1 from auth.users u where u.id = old.user_id)
     and not exists (
       select 1 from public.portfolios p where p.user_id = old.user_id and p.id <> old.id
     ) then
    raise exception 'no se puede borrar el último portafolio' using errcode = 'MP002';
  end if;
  return old;
end;
$$;

revoke execute on function public.portfolios_keep_one() from public, anon, authenticated;

create trigger portfolios_keep_one
  before delete on public.portfolios
  for each row execute function public.portfolios_keep_one();

-- 3. Alta de un portafolio con su cuenta -------------------------------------------------------------
-- `security invoker`: RLS aplica igual que si la persona insertara cada fila; el nombre lo validan
-- los CHECK y el índice único de arriba, y el tope, el trigger.
create or replace function public.create_portfolio(p_name text)
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

  insert into public.portfolios (user_id, name)
  values (v_uid, btrim(p_name))
  returning id into v_portfolio;

  insert into public.accounts (user_id, portfolio_id, name)
  values (v_uid, v_portfolio, 'Cuenta principal');

  return v_portfolio;
end;
$$;

revoke execute on function public.create_portfolio(text) from public, anon, authenticated;
grant execute on function public.create_portfolio(text) to authenticated;

-- 4. Últimas importaciones, con su portafolio ---------------------------------------------------------
-- Cambia el tipo de retorno: hay que borrarla y volver a crearla.
drop function public.recent_imports(int);

create function public.recent_imports(p_limit int default 10)
returns table (
  import_id uuid,
  source text,
  filename text,
  created_at timestamptz,
  rows_imported int,
  undone_at timestamptz,
  live_count int,
  portfolio_id uuid
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
    (select count(*)::int from public.transactions t where t.import_id = i.id),
    a.portfolio_id
  from public.imports i
  left join public.accounts a on a.id = i.account_id
  order by i.created_at desc
  limit p_limit;
end;
$$;

revoke execute on function public.recent_imports(int) from public, anon, authenticated;
grant execute on function public.recent_imports(int) to authenticated;
