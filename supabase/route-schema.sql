-- =====================================================================
-- Refill Route — additive schema
-- Run this AFTER schema.sql, in: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run.
-- Depends on public.touch_updated_at(), already created by schema.sql.
-- =====================================================================

-- 1. One saved route per driver per run. Stops live as JSONB, same style
--    as scent_clients.scents / scent_clients.photos.
create table if not exists public.routes (
  id            uuid primary key default gen_random_uuid(),
  route_date    date not null default current_date,
  driver        text not null default '',
  start_address text not null default '',
  stops         jsonb not null default '[]'::jsonb,
  -- stops shape: [{ "id": "...", "clientId": "uuid|null", "name": "...",
  --                 "address": "...", "scents": [{ "scent": "...", "ml": "500", "qty": "1" }] }]
  distance_km   numeric(12,2) not null default 0,
  opened_at     timestamptz,
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists routes_date_idx   on public.routes (route_date desc);
create index if not exists routes_driver_idx on public.routes (driver);

drop trigger if exists routes_touch on public.routes;
create trigger routes_touch before update on public.routes
  for each row execute function public.touch_updated_at();

-- 2. Running monthly distance per driver. month is 'YYYY-MM'.
create table if not exists public.mileage_totals (
  id          uuid primary key default gen_random_uuid(),
  driver      text not null,
  month       text not null,
  distance_km numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint mileage_totals_driver_month unique (driver, month)
);

drop trigger if exists mileage_totals_touch on public.mileage_totals;
create trigger mileage_totals_touch before update on public.mileage_totals
  for each row execute function public.touch_updated_at();

-- Add km to a driver's month in one atomic step (no read-modify-write races
-- when two devices report at once).
create or replace function public.add_mileage(p_driver text, p_month text, p_km numeric)
returns void
language sql
security invoker
as $$
  insert into public.mileage_totals (driver, month, distance_km)
  values (p_driver, p_month, p_km)
  on conflict (driver, month)
  do update set distance_km = public.mileage_totals.distance_km + excluded.distance_km;
$$;

-- 3. Row-Level Security: every authenticated user can see and edit everything,
--    same rule the rest of the app uses.
alter table public.routes         enable row level security;
alter table public.mileage_totals enable row level security;

drop policy if exists "routes read"   on public.routes;
drop policy if exists "routes insert" on public.routes;
drop policy if exists "routes update" on public.routes;
drop policy if exists "routes delete" on public.routes;
create policy "routes read"   on public.routes for select to authenticated using (true);
create policy "routes insert" on public.routes for insert to authenticated with check (auth.uid() is not null);
create policy "routes update" on public.routes for update to authenticated using (true) with check (true);
create policy "routes delete" on public.routes for delete to authenticated using (true);

drop policy if exists "mileage read"   on public.mileage_totals;
drop policy if exists "mileage insert" on public.mileage_totals;
drop policy if exists "mileage update" on public.mileage_totals;
drop policy if exists "mileage delete" on public.mileage_totals;
create policy "mileage read"   on public.mileage_totals for select to authenticated using (true);
create policy "mileage insert" on public.mileage_totals for insert to authenticated with check (auth.uid() is not null);
create policy "mileage update" on public.mileage_totals for update to authenticated using (true) with check (true);
create policy "mileage delete" on public.mileage_totals for delete to authenticated using (true);

-- 4. Realtime: the monthly totals refresh themselves on every device.
do $$
begin
  alter publication supabase_realtime add table public.mileage_totals;
exception when duplicate_object then null;
end $$;

-- =====================================================================
-- Done. The refill route at /ruta is now ready.
-- No location is ever stored: the trip meter runs only on the phone and
-- reports a single number of kilometres when you stop it.
-- =====================================================================
