-- Límite de intentos de verificación del código de ingreso (spec §10.6, ingreso con código).
--
-- El código tiene 6 dígitos (un millón de combinaciones): sin un tope de intentos se podría
-- adivinar. Como todavía no hay sesión, no hay `auth.uid()` a quien atribuir el uso; la clave es el
-- SHA-256 del email (no se guarda el email) y solo el servidor de la app, con la clave secreta
-- (`service_role`), llama a estas funciones. La política vive acá, no en quien llama:
-- 5 verificaciones por ventana de 15 minutos por email.
--
-- Compromiso conocido: quien conozca un email con acceso puede gastarle los intentos y dejarlo
-- 15 minutos sin poder entrar. Con acceso por invitación y pocas personas se acepta; la alternativa
-- (dejar adivinar) es peor.

create table public.login_attempts (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0,
  constraint login_attempts_key_format check (key ~ '^[0-9a-f]{64}$')
);
create index login_attempts_window_start_idx on public.login_attempts (window_start);

-- RLS activada y sin políticas: ni `anon` ni `authenticated` la leen ni la escriben.
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;
grant select, insert, update, delete on public.login_attempts to service_role;

-- Cuenta una verificación. Devuelve `false` cuando ya se pasó del límite ("esperá un rato").
create or replace function public.take_login_attempt(p_key text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit constant int := 5;
  v_window constant int := 900;
  v_count int;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'clave inválida' using errcode = '22023';
  end if;

  -- Limpieza oportunista: la tabla no crece sin límite aunque alguien pruebe emails al azar.
  delete from public.login_attempts where window_start < now() - interval '1 day';

  insert into public.login_attempts as a (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case
          when a.window_start <= now() - make_interval(secs => v_window) then now()
          else a.window_start
        end,
        count = case
          when a.window_start <= now() - make_interval(secs => v_window) then 1
          else a.count + 1
        end
  returning a.count into v_count;

  return v_count <= v_limit;
end;
$$;

-- Tras un ingreso exitoso el contador se borra: entrar no debe gastar intentos.
create or replace function public.clear_login_attempts(p_key text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'clave inválida' using errcode = '22023';
  end if;
  delete from public.login_attempts where key = p_key;
end;
$$;

revoke execute on function public.take_login_attempt(text) from public, anon, authenticated;
revoke execute on function public.clear_login_attempts(text) from public, anon, authenticated;
grant execute on function public.take_login_attempt(text) to service_role;
grant execute on function public.clear_login_attempts(text) to service_role;
