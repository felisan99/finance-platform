-- Registro solo por invitación (spec §11) y datos iniciales de cada usuario nuevo.
--
-- 1. `allowed_emails` es la lista de quiénes pueden tener cuenta. Para habilitar a alguien:
--      insert into public.allowed_emails (email) values ('amigo@ejemplo.com');
-- 2. El hook "Before User Created" de Supabase Auth (activado en config.toml) consulta esa
--    lista y rechaza el alta si el email no está. Solo se ejecuta al CREAR un usuario.
-- 3. Un trigger crea perfil, portafolio, cuenta y watchlist iniciales de cada usuario nuevo.

create table public.allowed_emails (
  email text primary key,
  note text,
  created_at timestamptz not null default now(),
  -- Siempre en minúsculas y sin espacios: el hook compara contra el email normalizado.
  constraint allowed_emails_normalized check (email = lower(btrim(email)) and email like '%_@_%')
);

-- RLS activado y sin políticas: nadie la lee ni la escribe por la Data API.
-- La consulta el hook (security definer) y la administra service_role o el dashboard.
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from anon, authenticated;

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.allowed_emails
    where email = lower(btrim(event -> 'user' ->> 'email'))
  ) then
    return '{}'::jsonb; -- alta permitida
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'Este email no tiene acceso a la app.',
      'http_code', 403
    )
  );
end;
$$;

-- Solo Supabase Auth puede ejecutarla: no debe quedar expuesta como RPC.
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_portfolio_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(split_part(coalesce(new.email, ''), '@', 1), ''));

  insert into public.portfolios (user_id, name)
  values (new.id, 'Portafolio principal')
  returning id into new_portfolio_id;

  insert into public.accounts (user_id, portfolio_id, name)
  values (new.id, new_portfolio_id, 'Cuenta principal');

  insert into public.watchlists (user_id) values (new.id);

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
