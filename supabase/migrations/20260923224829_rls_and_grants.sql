-- Seguridad de la Data API (PostgREST), en tres capas:
--   1. Privilegios por defecto: lo nuevo en `public` no queda expuesto hasta otorgarlo.
--   2. GRANT explícitos y mínimos por tabla.
--   3. RLS: cada usuario ve y modifica solo sus filas; las tablas de mercado son de solo lectura.
--
-- Regla del proyecto: toda migración que crea una tabla incluye sus GRANT y su RLS.
-- `service_role` (la clave secreta, solo en el servidor) conserva sus privilegios y salta RLS.

-- 1. Privilegios por defecto (patrón "hardening the Data API" de Supabase).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;

-- 2 y 3a. Tablas de mercado: lectura para usuarios autenticados; sin políticas de escritura.
alter table public.instruments enable row level security;
alter table public.prices_daily enable row level security;
alter table public.quotes_latest enable row level security;
alter table public.corporate_actions enable row level security;

revoke all on public.instruments, public.prices_daily, public.quotes_latest, public.corporate_actions
  from anon, authenticated;
grant select on public.instruments, public.prices_daily, public.quotes_latest, public.corporate_actions
  to authenticated;

create policy instruments_select on public.instruments
  for select to authenticated using (true);
create policy prices_daily_select on public.prices_daily
  for select to authenticated using (true);
create policy quotes_latest_select on public.quotes_latest
  for select to authenticated using (true);
create policy corporate_actions_select on public.corporate_actions
  for select to authenticated using (true);

-- 2 y 3b. Tablas de usuario.
alter table public.profiles enable row level security;
alter table public.portfolios enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.imports enable row level security;

revoke all on
  public.profiles, public.portfolios, public.accounts, public.transactions,
  public.watchlists, public.watchlist_items, public.imports
  from anon, authenticated;

-- profiles: la crea un trigger al registrarse y se borra en cascada con el usuario.
grant select on public.profiles to authenticated;
grant update (display_name, base_currency) on public.profiles to authenticated;

grant select, insert, update, delete on
  public.portfolios, public.accounts, public.transactions,
  public.watchlists, public.watchlist_items, public.imports
  to authenticated;

-- Políticas. `(select auth.uid())` se evalúa una sola vez por consulta (no por fila).
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy portfolios_select_own on public.portfolios
  for select to authenticated using (user_id = (select auth.uid()));
create policy portfolios_insert_own on public.portfolios
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy portfolios_update_own on public.portfolios
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy portfolios_delete_own on public.portfolios
  for delete to authenticated using (user_id = (select auth.uid()));

create policy accounts_select_own on public.accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy accounts_insert_own on public.accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy accounts_update_own on public.accounts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy accounts_delete_own on public.accounts
  for delete to authenticated using (user_id = (select auth.uid()));

create policy transactions_select_own on public.transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy transactions_insert_own on public.transactions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy transactions_update_own on public.transactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy transactions_delete_own on public.transactions
  for delete to authenticated using (user_id = (select auth.uid()));

create policy watchlists_select_own on public.watchlists
  for select to authenticated using (user_id = (select auth.uid()));
create policy watchlists_insert_own on public.watchlists
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy watchlists_update_own on public.watchlists
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy watchlists_delete_own on public.watchlists
  for delete to authenticated using (user_id = (select auth.uid()));

create policy watchlist_items_select_own on public.watchlist_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy watchlist_items_insert_own on public.watchlist_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy watchlist_items_update_own on public.watchlist_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy watchlist_items_delete_own on public.watchlist_items
  for delete to authenticated using (user_id = (select auth.uid()));

create policy imports_select_own on public.imports
  for select to authenticated using (user_id = (select auth.uid()));
create policy imports_insert_own on public.imports
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy imports_update_own on public.imports
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy imports_delete_own on public.imports
  for delete to authenticated using (user_id = (select auth.uid()));
