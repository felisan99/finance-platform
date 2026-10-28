-- Dividendos automáticos (Fase 8, parcial): la app propone los dividendos que el cron detectó
-- (`corporate_actions`) según lo que cada cuenta tenía el día anterior al ex-dividendo, con la
-- retención de EE. UU. para no residentes, y la persona los confirma o los descarta.
--
--  1. `transactions.source` acepta `auto_dividend` (los confirmados; `external_id` = `div:<id>` y
--     `divtax:<id>`, así la restricción `transactions_dedup` impide cargarlos dos veces).
--  2. `profiles.dividend_withholding_rate`: la retención que aplica EE. UU. a quien no reside ahí.
--     30 % por defecto (sin convenio de doble imposición, como Uruguay); con convenio suele ser 15 %.
--  3. `dividend_dismissals`: los propuestos que la persona descartó, por cuenta.

-- 1. Origen nuevo ------------------------------------------------------------------------------
alter table public.transactions drop constraint transactions_source_valid;
alter table public.transactions
  add constraint transactions_source_valid
  check (source in ('manual', 'delta_csv', 'ibkr_flex', 'csv', 'auto_dividend'));

-- 2. Retención por persona ---------------------------------------------------------------------
alter table public.profiles
  add column dividend_withholding_rate numeric(5,4) not null default 0.30,
  add constraint profiles_dividend_withholding_rate_range
    check (dividend_withholding_rate >= 0 and dividend_withholding_rate <= 1);

grant update (dividend_withholding_rate) on public.profiles to authenticated;

-- 3. Descartados -------------------------------------------------------------------------------
create table public.dividend_dismissals (
  account_id uuid not null,
  corporate_action_id uuid not null references public.corporate_actions on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, corporate_action_id),
  constraint dividend_dismissals_account_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete cascade
);
create index dividend_dismissals_user_id_idx on public.dividend_dismissals (user_id);
create index dividend_dismissals_corporate_action_idx
  on public.dividend_dismissals (corporate_action_id);

alter table public.dividend_dismissals enable row level security;
revoke all on public.dividend_dismissals from anon, authenticated;
grant select, insert, delete on public.dividend_dismissals to authenticated;
grant select, insert, update, delete on public.dividend_dismissals to service_role;

create policy dividend_dismissals_select_own on public.dividend_dismissals
  for select to authenticated using (user_id = (select auth.uid()));
create policy dividend_dismissals_insert_own on public.dividend_dismissals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy dividend_dismissals_delete_own on public.dividend_dismissals
  for delete to authenticated using (user_id = (select auth.uid()));
