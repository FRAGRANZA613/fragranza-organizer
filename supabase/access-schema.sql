-- =====================================================================
-- Control de acceso del equipo — additive schema
-- Correr en: Supabase Dashboard → SQL Editor → Run. Seguro de re-correr.
--
-- Que hace:
--   profiles.active    quien puede entrar al organizador
--   profiles.is_admin  quien puede quitar o devolver ese acceso
-- El bloqueo real vive en auth.users.banned_until; esta tabla es el
-- espejo que la app lee para pintar el equipo y cortar la sesion al vuelo.
-- =====================================================================

alter table public.profiles add column if not exists active   boolean not null default true;
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Los duenos de la cuenta mandan.
update public.profiles
   set is_admin = true
 where lower(email) in ('info@fragranza613.com', 'fragranza613@gmail.com');

-- Nadie se da acceso a si mismo: active e is_admin solo cambian desde el
-- service_role (la ruta /api/team/access) o desde este editor.
create or replace function public.guard_profile_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  new.active   := old.active;
  new.is_admin := old.is_admin;
  return new;
end $fn$;

drop trigger if exists profiles_guard_flags on public.profiles;
create trigger profiles_guard_flags
  before update on public.profiles
  for each row execute function public.guard_profile_flags();

-- La app lee estas columnas con la llave anon/authenticated.
grant select on public.profiles to anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- =====================================================================
-- Listo. Falta la variable SUPABASE_SERVICE_ROLE_KEY en Vercel.
-- =====================================================================
