-- Splits automáticos: cuando el cron detecta un split (`corporate_actions`), la app lo agrega solo
-- al libro de cada cuenta que tenía el activo el día anterior, con la sesión de la persona (RLS),
-- la próxima vez que abre una pantalla con su cartera. Sin el `SPLIT` en el libro, la cantidad no
-- cambia pero el precio sí, y la posición muestra una pérdida que no existe.
--
--  1. `transactions.source` acepta `auto_split` (`external_id` = `split:<id de corporate_actions>`:
--     la restricción `transactions_dedup` impide agregarlo dos veces en la misma cuenta).
--  2. `split_dismissals`: los splits automáticos que la persona borró, por cuenta, para no volver a
--     agregarlos.

-- 1. Origen nuevo ------------------------------------------------------------------------------
alter table public.transactions drop constraint transactions_source_valid;
alter table public.transactions
  add constraint transactions_source_valid
  check (source in ('manual', 'delta_csv', 'ibkr_flex', 'csv', 'auto_dividend', 'auto_split'));

-- 2. Borrados por la persona -------------------------------------------------------------------
create table public.split_dismissals (
  account_id uuid not null,
  corporate_action_id uuid not null references public.corporate_actions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, corporate_action_id),
  constraint split_dismissals_account_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade
);
create index split_dismissals_user_id_idx on public.split_dismissals (user_id);
create index split_dismissals_corporate_action_idx
  on public.split_dismissals (corporate_action_id);

alter table public.split_dismissals enable row level security;
revoke all on public.split_dismissals from anon, authenticated;
grant select, insert, delete on public.split_dismissals to authenticated;
grant select, insert, update, delete on public.split_dismissals to service_role;

create policy split_dismissals_select_own on public.split_dismissals
  for select to authenticated using (user_id = (select auth.uid()));
create policy split_dismissals_insert_own on public.split_dismissals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy split_dismissals_delete_own on public.split_dismissals
  for delete to authenticated using (user_id = (select auth.uid()));
