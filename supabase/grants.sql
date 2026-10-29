-- =====================================================================
-- Data API grants — correr DESPUES de cualquier otro schema.
-- Seguro de re-correr.
--
-- Por que existe: desde el 30 de octubre de 2026 Supabase dejo de dar
-- acceso automatico al Data API a las tablas nuevas del esquema public.
-- Una tabla sin grants existe en la base pero el app la ve como si no
-- existiera (error PGRST205). Este archivo hace dos cosas:
--   1. Pone los grants a todo lo que ya existe hoy.
--   2. Deja privilegios por defecto, para que toda tabla futura los
--      reciba sola y no haya que acordarse de esto nunca mas.
--
-- Ojo: los grants solo dicen si el API puede TOCAR la tabla. Quien ve
-- que fila la sigue decidiendo el RLS de cada schema, que en este
-- proyecto es siempre "to authenticated".
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

-- 1. Ponerse al dia con lo que ya existe.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('grant select on public.%I to anon', r.tablename);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tablename);
    execute format('grant select, insert, update, delete on public.%I to service_role', r.tablename);
  end loop;
end $$;

grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- 2. Y que las tablas futuras nazcan ya con permiso.
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- =====================================================================
-- Listo.
-- =====================================================================
