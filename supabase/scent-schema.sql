-- =====================================================================
-- Scent Scheduler — additive schema
-- Run this AFTER schema.sql, in: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run.
-- =====================================================================

-- 1. Current month context (single-row table; id = 1)
create table if not exists public.scent_state (
  id int primary key default 1,
  current_month text not null,
  updated_at timestamptz not null default now(),
  constraint scent_state_single_row check (id = 1)
);

insert into public.scent_state (id, current_month)
values (1, to_char(now(), 'FMMonth YYYY'))
on conflict (id) do nothing;

-- 2. Recurring service stops (the heart of the scheduler)
create table if not exists public.scent_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  time text default '',
  day text not null default 'Monday',
  week int not null default 1 check (week between 1 and 4),
  contact text default '',
  notes text default '',
  technician text default 'Tech 1',
  scents jsonb not null default '[]'::jsonb,
  -- scents shape: [{ "scent": "Cedarwood", "ml": "500" }, ...]
  service_type text not null default 'physical' check (service_type in ('physical','shipping')),
  done boolean not null default false,
  completed_at timestamptz,
  service_notes text default '',
  notes_updated_at timestamptz,
  tracking text default '',
  photos jsonb not null default '[]'::jsonb,
  -- photos shape: [{ "id": "...", "path": "uuid.jpg", "url": "https://...", "uploadedAt": "..." }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scent_clients_week_idx on public.scent_clients (week);

drop trigger if exists scent_clients_touch on public.scent_clients;
create trigger scent_clients_touch before update on public.scent_clients
  for each row execute function public.touch_updated_at();

-- 3. Archive of prior months (entire client roster snapshotted as JSONB)
create table if not exists public.scent_history (
  id uuid primary key default gen_random_uuid(),
  month text not null,
  archived_at timestamptz not null default now(),
  clients jsonb not null
);

create index if not exists scent_history_archived_idx on public.scent_history (archived_at desc);

-- 4. Row-Level Security: every authenticated user can see and edit everything.
alter table public.scent_state    enable row level security;
alter table public.scent_clients  enable row level security;
alter table public.scent_history  enable row level security;

drop policy if exists "scent_state read"   on public.scent_state;
drop policy if exists "scent_state insert" on public.scent_state;
drop policy if exists "scent_state update" on public.scent_state;
create policy "scent_state read"   on public.scent_state for select to authenticated using (true);
create policy "scent_state insert" on public.scent_state for insert to authenticated with check (true);
create policy "scent_state update" on public.scent_state for update to authenticated using (true) with check (true);

drop policy if exists "scent_clients read"   on public.scent_clients;
drop policy if exists "scent_clients insert" on public.scent_clients;
drop policy if exists "scent_clients update" on public.scent_clients;
drop policy if exists "scent_clients delete" on public.scent_clients;
create policy "scent_clients read"   on public.scent_clients for select to authenticated using (true);
create policy "scent_clients insert" on public.scent_clients for insert to authenticated with check (auth.uid() is not null);
create policy "scent_clients update" on public.scent_clients for update to authenticated using (true) with check (true);
create policy "scent_clients delete" on public.scent_clients for delete to authenticated using (true);

drop policy if exists "scent_history read"   on public.scent_history;
drop policy if exists "scent_history insert" on public.scent_history;
drop policy if exists "scent_history delete" on public.scent_history;
create policy "scent_history read"   on public.scent_history for select to authenticated using (true);
create policy "scent_history insert" on public.scent_history for insert to authenticated with check (auth.uid() is not null);
create policy "scent_history delete" on public.scent_history for delete to authenticated using (true);

-- 5. Realtime: stream changes so multiple devices stay in sync live
alter publication supabase_realtime add table public.scent_clients;
alter publication supabase_realtime add table public.scent_state;

-- 6. Storage bucket for proof-of-service photos.
--    Public bucket so the React component can render images by URL without
--    minting signed URLs every render. Uploads/deletes still require auth.
insert into storage.buckets (id, name, public)
values ('scent-photos', 'scent-photos', true)
on conflict (id) do nothing;

drop policy if exists "scent-photos read all"      on storage.objects;
drop policy if exists "scent-photos write auth"    on storage.objects;
drop policy if exists "scent-photos delete auth"   on storage.objects;
create policy "scent-photos read all"
  on storage.objects for select
  using (bucket_id = 'scent-photos');
create policy "scent-photos write auth"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'scent-photos');
create policy "scent-photos delete auth"
  on storage.objects for delete to authenticated
  using (bucket_id = 'scent-photos');

-- =====================================================================
-- Done. The scent scheduler at /scents is now ready.
-- =====================================================================
