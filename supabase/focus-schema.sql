-- =====================================================================
-- Enfoque 613 — additive schema
-- Correr en: Supabase Dashboard → SQL Editor → Run. Seguro de re-correr.
--
-- No crea una lista nueva: le pone tres campos a los pendientes que ya
-- existen en public.items, para poder ordenarlos por importancia y
-- marcar cuáles son "mis 3 de hoy".
--   category  qué tipo de pendiente es (cerrar, cobrar, vip, operativo…)
--   urgent    de verdad urgente; manda sobre todo lo demás
--   focus_on  el día en que lo elegiste como prioridad
-- =====================================================================

alter table public.items add column if not exists category text not null default 'otro';
alter table public.items add column if not exists urgent   boolean not null default false;
alter table public.items add column if not exists focus_on date;

do $$
begin
  alter table public.items add constraint items_category_check
    check (category in ('cerrar', 'cobrar', 'distribuidor', 'vip', 'seguimiento',
                        'instalacion', 'operativo', 'otro', 'algun_dia'));
exception when duplicate_object then null;
end $$;

create index if not exists items_focus_idx    on public.items (focus_on);
create index if not exists items_category_idx on public.items (category);

-- Los grants ya los cubre supabase/grants.sql.
-- =====================================================================
