-- =====================================================================
-- Pipeline de ventas — additive schema
-- Run this AFTER schema.sql, in: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run.
-- Depends on public.touch_updated_at(), already created by schema.sql.
--
-- Note: this file grants Data API access explicitly. From 30 Oct 2026
-- Supabase stops doing that automatically for newly created tables, so the
-- grants below are what keeps this schema working if it is ever re-run on a
-- fresh project, a preview branch, or a local `supabase db reset`.
-- =====================================================================

-- 1. One row per deal. Stages run left to right; 'ganado' and 'perdido'
--    take the deal out of the active board but keep its history.
create table if not exists public.deals (
  id                uuid primary key default gen_random_uuid(),
  contact           text not null,
  company           text not null default '',
  phone             text not null default '',
  email             text not null default '',
  value_usd         numeric(12,2) not null default 0,
  -- 'venta' = one-off sale, value_usd is the whole deal.
  -- 'suscripcion' = recurring fragrance plan, value_usd is per month.
  deal_type         text not null default 'venta'
                    check (deal_type in ('venta','suscripcion')),
  client_type       text not null default '',
  products          text not null default '',
  stage             text not null default 'prospecto'
                    check (stage in ('prospecto','contactado','cotizacion',
                                     'negociacion','por_cerrar','ganado','perdido')),
  probability       int not null default 0 check (probability between 0 and 100),
  priority          text not null default 'media'
                    check (priority in ('alta','media','baja')),
  next_step         text not null default '',
  follow_up_on      date,
  expected_close_on date,
  lost_reason       text not null default '',
  closed_on         date,
  sort              int not null default 0,
  owner             text not null default '',
  created_by        text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Additive for installs that ran an earlier version of this script.
alter table public.deals add column if not exists deal_type text not null default 'venta';
do $$
begin
  alter table public.deals add constraint deals_deal_type_check
    check (deal_type in ('venta','suscripcion'));
exception when duplicate_object then null;
end $$;

create index if not exists deals_stage_idx     on public.deals (stage);
create index if not exists deals_followup_idx  on public.deals (follow_up_on);
create index if not exists deals_closed_idx    on public.deals (closed_on desc);

drop trigger if exists deals_touch on public.deals;
create trigger deals_touch before update on public.deals
  for each row execute function public.touch_updated_at();

-- 2. Call log / notes per deal, newest first in the UI.
create table if not exists public.deal_notes (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals (id) on delete cascade,
  body       text not null,
  author     text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists deal_notes_deal_idx on public.deal_notes (deal_id, created_at desc);

-- 3. Row-Level Security: every authenticated user can see and edit everything,
--    the same rule the rest of the app uses.
alter table public.deals      enable row level security;
alter table public.deal_notes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['deals','deal_notes']
  loop
    execute format('drop policy if exists "%s read"   on public.%I', t, t);
    execute format('drop policy if exists "%s insert" on public.%I', t, t);
    execute format('drop policy if exists "%s update" on public.%I', t, t);
    execute format('drop policy if exists "%s delete" on public.%I', t, t);
    execute format('create policy "%s read"   on public.%I for select to authenticated using (true)', t, t);
    execute format('create policy "%s insert" on public.%I for insert to authenticated with check (auth.uid() is not null)', t, t);
    execute format('create policy "%s update" on public.%I for update to authenticated using (true) with check (true)', t, t);
    execute format('create policy "%s delete" on public.%I for delete to authenticated using (true)', t, t);
  end loop;
end $$;

-- 4. Data API grants. RLS decides which rows; these decide whether the API
--    can reach the table at all.
grant select on public.deals to anon;
grant select, insert, update, delete on public.deals to authenticated;
grant select, insert, update, delete on public.deals to service_role;

grant select on public.deal_notes to anon;
grant select, insert, update, delete on public.deal_notes to authenticated;
grant select, insert, update, delete on public.deal_notes to service_role;

-- 5. Realtime: the board updates itself while two people work it.
do $$
declare t text;
begin
  foreach t in array array['deals','deal_notes']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- =====================================================================
-- Done. The sales pipeline at /pipeline is now ready.
-- =====================================================================
