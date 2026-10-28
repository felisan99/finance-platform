-- Asistente: conversaciones, memoria de largo plazo, métricas por turno y sus límites de uso.
--
--  1. assistant_conversations: una por cada "Nueva conversación". Guarda el resumen de los mensajes
--     viejos (autocompactación) y hasta qué mensaje cubre.
--  2. assistant_messages: los mensajes en el formato de la UI del AI SDK (jsonb, validado con Zod
--     en la app). Solo se agregan o se borran: un mensaje no se edita.
--  3. assistant_memory: perfil de riesgo, objetivos y hechos estables que la persona contó. Nunca
--     números de la cartera (lo valida la app). Hasta 30 por persona (`AM001`).
--  4. assistant_runs: una fila por turno con tools, tokens, costo, latencia y errores, sin el
--     contenido de los mensajes. Sin FK a la conversación: las métricas sobreviven a borrarla.
--  5. take_rate_limit: claves nuevas `assistant_message`, `assistant_daily` y `news_search`.
--
-- Todo con RLS por `user_id`, como el resto de las tablas de usuario.

-- 1. Conversaciones ------------------------------------------------------------------------------
create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  summary text,
  -- `seq` del último mensaje que ya está dentro de `summary` (0 = ninguno).
  summarized_through bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_conversations_id_user_key unique (id, user_id),
  constraint assistant_conversations_summary_length check (char_length(summary) <= 8000),
  constraint assistant_conversations_summarized_through_nonneg check (summarized_through >= 0)
);
create index assistant_conversations_user_created_idx
  on public.assistant_conversations (user_id, created_at desc);

-- 2. Mensajes ------------------------------------------------------------------------------------
create table public.assistant_messages (
  seq bigint generated always as identity primary key,
  -- El id del mensaje en la UI (lo genera el AI SDK): único dentro de la conversación.
  ui_id text not null,
  conversation_id uuid not null,
  user_id uuid not null references auth.users on delete cascade,
  role text not null,
  message jsonb not null,
  created_at timestamptz not null default now(),
  constraint assistant_messages_conversation_fk foreign key (conversation_id, user_id)
    references public.assistant_conversations (id, user_id) on delete cascade,
  constraint assistant_messages_ui_id_key unique (conversation_id, ui_id),
  constraint assistant_messages_ui_id_format check (ui_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint assistant_messages_role_valid check (role in ('user', 'assistant')),
  constraint assistant_messages_size check (octet_length(message::text) <= 200000)
);
create index assistant_messages_conversation_seq_idx
  on public.assistant_messages (conversation_id, seq);
create index assistant_messages_user_id_idx on public.assistant_messages (user_id);

-- 3. Memoria -------------------------------------------------------------------------------------
create table public.assistant_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_memory_kind_valid check (kind in ('risk_profile', 'goal', 'fact')),
  constraint assistant_memory_content_length check (
    char_length(content) between 1 and 300 and content = btrim(content)
  )
);
create index assistant_memory_user_id_idx on public.assistant_memory (user_id);

create or replace function public.assistant_memory_check_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Serializa las altas de una misma persona: dos simultáneas no pueden pasar las dos el tope.
  perform pg_advisory_xact_lock(hashtextextended('assistant_memory:' || new.user_id::text, 0));
  if (select count(*) from public.assistant_memory m where m.user_id = new.user_id) >= 30 then
    raise exception 'máximo 30 recuerdos por persona' using errcode = 'AM001';
  end if;
  return new;
end;
$$;

revoke execute on function public.assistant_memory_check_limit() from public, anon, authenticated;

create trigger assistant_memory_limit
  before insert on public.assistant_memory
  for each row execute function public.assistant_memory_check_limit();

-- 4. Métricas por turno --------------------------------------------------------------------------
create table public.assistant_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  conversation_id uuid,
  created_at timestamptz not null default now(),
  -- El modelo que respondió (puede ser el de respaldo) y si hubo que recurrir a él.
  model text,
  fallback_used boolean not null default false,
  steps int not null default 0,
  -- [{ "name": "get_positions", "ok": true, "ms": 120 }, …]
  tools jsonb not null default '[]'::jsonb,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(12, 6),
  ttft_ms int,
  latency_ms int,
  finish_reason text,
  error_code text,
  compacted boolean not null default false,
  context_tokens_before int,
  context_tokens_after int,
  constraint assistant_runs_tools_array check (jsonb_typeof(tools) = 'array'),
  constraint assistant_runs_counts_nonneg check (
    steps >= 0
    and coalesce(input_tokens, 0) >= 0
    and coalesce(output_tokens, 0) >= 0
    and coalesce(ttft_ms, 0) >= 0
    and coalesce(latency_ms, 0) >= 0
  ),
  constraint assistant_runs_text_lengths check (
    char_length(coalesce(model, '')) <= 200
    and char_length(coalesce(finish_reason, '')) <= 40
    and char_length(coalesce(error_code, '')) <= 80
  ),
  constraint assistant_runs_tools_size check (octet_length(tools::text) <= 8000)
);
create index assistant_runs_user_created_idx
  on public.assistant_runs (user_id, created_at desc);

-- RLS y permisos ---------------------------------------------------------------------------------
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_memory enable row level security;
alter table public.assistant_runs enable row level security;

revoke all on
  public.assistant_conversations, public.assistant_messages,
  public.assistant_memory, public.assistant_runs
  from anon, authenticated;

grant select, insert, delete on public.assistant_conversations to authenticated;
grant update (summary, summarized_through, updated_at) on public.assistant_conversations to authenticated;
grant select, insert, delete on public.assistant_messages to authenticated;
grant select, insert, update, delete on public.assistant_memory to authenticated;
grant select, insert on public.assistant_runs to authenticated;
grant select, insert, update, delete on
  public.assistant_conversations, public.assistant_messages,
  public.assistant_memory, public.assistant_runs
  to service_role;

create policy assistant_conversations_select_own on public.assistant_conversations
  for select to authenticated using (user_id = (select auth.uid()));
create policy assistant_conversations_insert_own on public.assistant_conversations
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy assistant_conversations_update_own on public.assistant_conversations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy assistant_conversations_delete_own on public.assistant_conversations
  for delete to authenticated using (user_id = (select auth.uid()));

create policy assistant_messages_select_own on public.assistant_messages
  for select to authenticated using (user_id = (select auth.uid()));
create policy assistant_messages_insert_own on public.assistant_messages
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy assistant_messages_delete_own on public.assistant_messages
  for delete to authenticated using (user_id = (select auth.uid()));

create policy assistant_memory_select_own on public.assistant_memory
  for select to authenticated using (user_id = (select auth.uid()));
create policy assistant_memory_insert_own on public.assistant_memory
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy assistant_memory_update_own on public.assistant_memory
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy assistant_memory_delete_own on public.assistant_memory
  for delete to authenticated using (user_id = (select auth.uid()));

create policy assistant_runs_select_own on public.assistant_runs
  for select to authenticated using (user_id = (select auth.uid()));
create policy assistant_runs_insert_own on public.assistant_runs
  for insert to authenticated with check (user_id = (select auth.uid()));

-- 5. Límites de uso ------------------------------------------------------------------------------
-- Misma función que en rate_limit_fixed_policies, con tres claves más. Cada pregunta al asistente
-- son varios pasos contra OpenRouter, que limita por día los modelos gratuitos.
create or replace function public.take_rate_limit(p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int;
  v_window int;
  v_count int;
begin
  if v_uid is null then
    return false;
  end if;

  -- Política por clave: `v_limit` usos por ventana de `v_window` segundos.
  case p_key
    when 'refresh_quotes'    then v_limit := 1;  v_window := 300;   -- "Actualizar ahora": 1 cada 5 min (spec §7.2)
    when 'search_symbols'    then v_limit := 30; v_window := 60;
    when 'import_csv'        then v_limit := 20; v_window := 3600;
    when 'assistant_message' then v_limit := 8;  v_window := 300;   -- preguntas seguidas
    when 'assistant_daily'   then v_limit := 60; v_window := 86400; -- preguntas por día
    when 'news_search'       then v_limit := 20; v_window := 86400; -- Tavily: plan gratuito
    else
      raise exception 'clave de límite desconocida' using errcode = '22023';
  end case;

  insert into public.rate_limits as r (user_id, key, window_start, count)
  values (v_uid, p_key, now(), 1)
  on conflict (user_id, key) do update
    set window_start = case
          when r.window_start <= now() - make_interval(secs => v_window) then now()
          else r.window_start
        end,
        count = case
          when r.window_start <= now() - make_interval(secs => v_window) then 1
          else r.count + 1
        end
  returning r.count into v_count;

  return v_count <= v_limit;
end;
$$;

revoke execute on function public.take_rate_limit(text) from public, anon, authenticated;
grant execute on function public.take_rate_limit(text) to authenticated;
