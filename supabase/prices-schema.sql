-- ============================================================
-- Price Comparison — additive schema
-- Run this AFTER schema.sql, in: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run.
-- Depends on public.touch_updated_at(), already created by schema.sql
-- (same dependency as scent-schema.sql).
-- ============================================================

-- 1. Every price observation the team logs. Append-only by convention:
--    a new check = a new row, so old rows become the price history.
create table if not exists public.price_entries (
  id               uuid primary key default gen_random_uuid(),
  item             text not null,
  country          text not null,
  our_price        numeric(12,2) not null default 0,
  competitor       text not null,
  competitor_model text not null default '',
  competitor_price numeric(12,2) not null default 0,
  photo_url        text not null default '',
  photo_path       text not null default '',
  checked_on       date not null default current_date,
  recorded_by      text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Additive for installs that ran an earlier version of this script.
alter table public.price_entries add column if not exists competitor_model text not null default '';
alter table public.price_entries add column if not exists photo_url        text not null default '';
alter table public.price_entries add column if not exists photo_path       text not null default '';

create index if not exists price_entries_item_idx    on public.price_entries (item);
create index if not exists price_entries_country_idx on public.price_entries (country);
create index if not exists price_entries_checked_idx on public.price_entries (checked_on desc);

drop trigger if exists price_entries_touch on public.price_entries;
create trigger price_entries_touch before update on public.price_entries
  for each row execute function public.touch_updated_at();

-- 2. Row-Level Security: every authenticated user can see and edit everything.
alter table public.price_entries enable row level security;

drop policy if exists "price_entries read"   on public.price_entries;
drop policy if exists "price_entries insert" on public.price_entries;
drop policy if exists "price_entries update" on public.price_entries;
drop policy if exists "price_entries delete" on public.price_entries;
create policy "price_entries read"   on public.price_entries for select to authenticated using (true);
create policy "price_entries insert" on public.price_entries for insert to authenticated with check (auth.uid() is not null);
create policy "price_entries update" on public.price_entries for update to authenticated using (true) with check (true);
create policy "price_entries delete" on public.price_entries for delete to authenticated using (true);

-- 3. Realtime: stream changes so the whole team stays in sync live.
do $$
begin
  alter publication supabase_realtime add table public.price_entries;
exception
  when duplicate_object then null;
end $$;

-- 4. Storage bucket for competitor product photos.
--    Public bucket so the React component can render images by URL without
--    minting signed URLs every render. Uploads/deletes still require auth.
insert into storage.buckets (id, name, public)
values ('price-photos', 'price-photos', true)
on conflict (id) do nothing;

drop policy if exists "price-photos read all"    on storage.objects;
drop policy if exists "price-photos write auth"  on storage.objects;
drop policy if exists "price-photos delete auth" on storage.objects;
create policy "price-photos read all"
  on storage.objects for select
  using (bucket_id = 'price-photos');
create policy "price-photos write auth"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'price-photos');
create policy "price-photos delete auth"
  on storage.objects for delete to authenticated
  using (bucket_id = 'price-photos');

-- ============================================================
-- Done. The price comparison at /precios is now ready.
-- ============================================================
