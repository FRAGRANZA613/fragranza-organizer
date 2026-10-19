-- =====================================================================
-- Almacén de Cajas — additive schema
-- Run this AFTER schema.sql, in: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run.
-- Depends on public.touch_updated_at(), already created by schema.sql.
-- =====================================================================

-- 1. Warehouses. One of them is the main one; the rest are holding bodegas.
create table if not exists public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_main    boolean not null default false,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.warehouses (name, is_main, sort)
values ('Bodega 2', false, 1), ('Almacén principal', true, 2)
on conflict (name) do nothing;

drop trigger if exists warehouses_touch on public.warehouses;
create trigger warehouses_touch before update on public.warehouses
  for each row execute function public.touch_updated_at();

-- 2. The fixed product list. Boxes point at these, so the per-product
--    totals never split because someone typed a name two different ways.
create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sku        text not null default '',
  unit       text not null default 'u.',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- 3. The boxes themselves.
create table if not exists public.boxes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  warehouse_id uuid references public.warehouses (id) on delete set null,
  location     text not null default '',
  arrived_on   date not null default current_date,
  moved_on     date,
  notes        text not null default '',
  photo_url    text not null default '',
  photo_path   text not null default '',
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists boxes_warehouse_idx on public.boxes (warehouse_id);
create index if not exists boxes_arrived_idx   on public.boxes (arrived_on desc);

drop trigger if exists boxes_touch on public.boxes;
create trigger boxes_touch before update on public.boxes
  for each row execute function public.touch_updated_at();

-- Next free code: C-001, C-002, … Computed in the database so two phones
-- adding a box at the same second cannot land on the same number.
create or replace function public.next_box_code()
returns text
language sql
stable
security invoker
as $$
  select 'C-' || lpad(
    (coalesce(max(nullif(regexp_replace(code, '[^0-9]', '', 'g'), '')::int), 0) + 1)::text,
    3, '0')
  from public.boxes;
$$;

-- 4. What is inside each box right now: one row per product per box.
create table if not exists public.box_items (
  id         uuid primary key default gen_random_uuid(),
  box_id     uuid not null references public.boxes (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  qty        numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint box_items_box_product unique (box_id, product_id),
  constraint box_items_qty_not_negative check (qty >= 0)
);

create index if not exists box_items_box_idx     on public.box_items (box_id);
create index if not exists box_items_product_idx on public.box_items (product_id);

drop trigger if exists box_items_touch on public.box_items;
create trigger box_items_touch before update on public.box_items
  for each row execute function public.touch_updated_at();

-- 5. Movement log. Every transfer and every unit taken out is recorded,
--    so the current contents are always explainable.
create table if not exists public.box_movements (
  id                uuid primary key default gen_random_uuid(),
  box_id            uuid references public.boxes (id) on delete set null,
  box_code          text not null default '',
  product_id        uuid references public.products (id) on delete set null,
  product_name      text not null default '',
  kind              text not null default 'out'
                    check (kind in ('in', 'out', 'transfer', 'adjust')),
  qty               numeric(12,2) not null default 0,
  from_warehouse_id uuid references public.warehouses (id) on delete set null,
  to_warehouse_id   uuid references public.warehouses (id) on delete set null,
  note              text not null default '',
  moved_by          text not null default '',
  created_at        timestamptz not null default now()
);

create index if not exists box_movements_created_idx on public.box_movements (created_at desc);
create index if not exists box_movements_box_idx     on public.box_movements (box_id);

-- Take units out of a box: decrements the line and logs the movement in one
-- step, so a half-applied withdrawal is impossible.
create or replace function public.take_units(
  p_box_id uuid, p_product_id uuid, p_qty numeric, p_note text, p_by text
)
returns void
language plpgsql
security invoker
as $$
declare
  v_have numeric;
  v_code text;
  v_product text;
  v_wh uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  select qty into v_have from public.box_items
   where box_id = p_box_id and product_id = p_product_id for update;

  if v_have is null then
    raise exception 'Ese producto no está en la caja';
  end if;
  if v_have < p_qty then
    raise exception 'Solo quedan % unidades', v_have;
  end if;

  select code, warehouse_id into v_code, v_wh from public.boxes where id = p_box_id;
  select name into v_product from public.products where id = p_product_id;

  update public.box_items set qty = qty - p_qty
   where box_id = p_box_id and product_id = p_product_id;

  delete from public.box_items
   where box_id = p_box_id and product_id = p_product_id and qty = 0;

  insert into public.box_movements
    (box_id, box_code, product_id, product_name, kind, qty,
     from_warehouse_id, note, moved_by)
  values
    (p_box_id, coalesce(v_code, ''), p_product_id, coalesce(v_product, ''), 'out', p_qty,
     v_wh, coalesce(p_note, ''), coalesce(p_by, ''));
end;
$$;

-- Move a whole box to another warehouse, logging it.
create or replace function public.move_box(
  p_box_id uuid, p_to_warehouse uuid, p_by text
)
returns void
language plpgsql
security invoker
as $$
declare
  v_from uuid;
  v_code text;
begin
  select warehouse_id, code into v_from, v_code from public.boxes where id = p_box_id;
  if v_code is null then
    raise exception 'Caja no encontrada';
  end if;

  update public.boxes
     set warehouse_id = p_to_warehouse, moved_on = current_date
   where id = p_box_id;

  insert into public.box_movements
    (box_id, box_code, kind, qty, from_warehouse_id, to_warehouse_id, moved_by)
  values
    (p_box_id, v_code, 'transfer', 0, v_from, p_to_warehouse, coalesce(p_by, ''));
end;
$$;

-- 6. Row-Level Security: every authenticated user can see and edit everything,
--    the same rule the rest of the app uses.
alter table public.warehouses    enable row level security;
alter table public.products      enable row level security;
alter table public.boxes         enable row level security;
alter table public.box_items     enable row level security;
alter table public.box_movements enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['warehouses','products','boxes','box_items','box_movements']
  loop
    execute format('drop policy if exists "%s read"   on public.%I', t, t);
    execute format('drop policy if exists "%s insert" on public.%I', t, t);
    execute format('drop policy if exists "%s update" on public.%I', t, t);
    execute format('drop policy if exists "%s delete" on public.%I', t, t);
    execute format(
      'create policy "%s read"   on public.%I for select to authenticated using (true)', t, t);
    execute format(
      'create policy "%s insert" on public.%I for insert to authenticated with check (auth.uid() is not null)', t, t);
    execute format(
      'create policy "%s update" on public.%I for update to authenticated using (true) with check (true)', t, t);
    execute format(
      'create policy "%s delete" on public.%I for delete to authenticated using (true)', t, t);
  end loop;
end $$;

-- 7. Realtime: two people counting the same bodega stay in sync.
do $$
declare
  t text;
begin
  foreach t in array array['boxes','box_items','box_movements','products','warehouses']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 8. Storage bucket for box photos. Public for reading so the component can
--    render them by URL; uploads and deletes still require auth.
insert into storage.buckets (id, name, public)
values ('box-photos', 'box-photos', true)
on conflict (id) do nothing;

drop policy if exists "box-photos read all"    on storage.objects;
drop policy if exists "box-photos write auth"  on storage.objects;
drop policy if exists "box-photos delete auth" on storage.objects;
create policy "box-photos read all"
  on storage.objects for select using (bucket_id = 'box-photos');
create policy "box-photos write auth"
  on storage.objects for insert to authenticated with check (bucket_id = 'box-photos');
create policy "box-photos delete auth"
  on storage.objects for delete to authenticated using (bucket_id = 'box-photos');

-- =====================================================================
-- Done. The box warehouse at /cajas is now ready.
-- =====================================================================
