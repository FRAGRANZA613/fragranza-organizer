-- =====================================================================
-- Invoices — additive schema for the Overdue Invoices tab in Organizer.
-- Run this in: Supabase Dashboard -> SQL Editor -> Run.
-- Safe to re-run.
-- =====================================================================

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null default '',
  company_id text not null default '',
  amount_due numeric(12,2) not null default 0,
  due_date date,
  contact text not null default '',
  notes text default '',
  paid boolean not null default false,
  paid_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Additive columns for installs that ran an earlier version of this script.
alter table public.invoices add column if not exists company_id  text not null default '';
alter table public.invoices add column if not exists assigned_to uuid references auth.users(id) on delete set null;

-- Backfill: any existing invoice without an assignee defaults to its creator,
-- so previously-created rows remain visible to whoever made them.
update public.invoices
set assigned_to = created_by
where assigned_to is null and created_by is not null;

create index if not exists invoices_due_date_idx    on public.invoices (due_date);
create index if not exists invoices_paid_idx        on public.invoices (paid);
create index if not exists invoices_company_idx     on public.invoices (company_id);
create index if not exists invoices_assigned_to_idx on public.invoices (assigned_to);

drop trigger if exists invoices_touch on public.invoices;
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

alter table public.invoices enable row level security;

-- Visibility model: an invoice is private to its assignee.
-- A user can see (and edit / delete) only invoices where assigned_to = auth.uid().
-- The creator can always see invoices they created (so they can hand-off).
drop policy if exists "invoices read"   on public.invoices;
drop policy if exists "invoices insert" on public.invoices;
drop policy if exists "invoices update" on public.invoices;
drop policy if exists "invoices delete" on public.invoices;
create policy "invoices read"
  on public.invoices for select to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid());
create policy "invoices insert"
  on public.invoices for insert to authenticated
  with check (auth.uid() is not null);
create policy "invoices update"
  on public.invoices for update to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid())
  with check (assigned_to = auth.uid() or created_by = auth.uid());
create policy "invoices delete"
  on public.invoices for delete to authenticated
  using (assigned_to = auth.uid() or created_by = auth.uid());

alter publication supabase_realtime add table public.invoices;

-- =====================================================================
-- Done. The Invoices tab in the Organizer is now ready.
-- =====================================================================
