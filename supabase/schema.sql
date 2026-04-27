-- =====================================================================
-- Fragranza Organizer - Supabase schema
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run
-- =====================================================================

-- 1. Profiles: one row per signed-in user (auto-created via trigger).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

-- 2. The shared workspace stores its own metadata. We use a single-workspace
--    model: every authenticated user belongs to the same workspace.
--    (You can add multi-workspace later by adding a workspace_id column.)

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('task','meeting','todo')),
  priority text not null check (priority in ('high','medium','low')),
  status text not null default 'not-started' check (status in ('not-started','in-progress','blocked','done')),
  hours numeric default 0,
  due timestamptz,
  notes text default '',
  assignee uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_due_idx       on public.items (due);
create index if not exists items_assignee_idx  on public.items (assignee);
create index if not exists items_status_idx    on public.items (status);

-- 3. Auto-create a profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Keep updated_at fresh on items.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

-- 5. Row-Level Security: every authenticated user can see and edit
--    every item and profile. Anonymous users see nothing.
alter table public.profiles enable row level security;
alter table public.items    enable row level security;

drop policy if exists "profiles read all"   on public.profiles;
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles read all"
  on public.profiles for select
  to authenticated using (true);
create policy "profiles update self"
  on public.profiles for update
  to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "items read all"   on public.items;
drop policy if exists "items insert auth" on public.items;
drop policy if exists "items update auth" on public.items;
drop policy if exists "items delete auth" on public.items;
create policy "items read all"   on public.items for select to authenticated using (true);
create policy "items insert auth" on public.items for insert to authenticated with check (auth.uid() is not null);
create policy "items update auth" on public.items for update to authenticated using (true) with check (true);
create policy "items delete auth" on public.items for delete to authenticated using (true);

-- 6. Realtime: enable change-streaming on items so all open clients sync live.
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.profiles;

-- =====================================================================
-- Done. Now go to Authentication → Providers → Email and:
--   * Enable "Email" provider
--   * Disable "Confirm email" (we use OTP magic links, not email confirms)
--   * Enable "Magic Link"
-- Then plug Resend into Authentication → Emails → SMTP Settings.
-- =====================================================================
