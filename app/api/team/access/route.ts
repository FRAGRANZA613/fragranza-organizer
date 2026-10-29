// POST /api/team/access — quita o devuelve el acceso de un companero.
//
// Solo un perfil con is_admin puede llamarla, y nunca sobre si mismo.
// El bloqueo de verdad se hace en auth.users (ban), que es lo que impide
// pedir un magic link y renovar la sesion; profiles.active es el espejo
// que ve el equipo y que el middleware usa para cortar al instante.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** 100 anos. GoTrue quiere una duracion, no una fecha. */
const FOREVER = "876000h";

export async function POST(request: Request) {
  let body: { userId?: string; active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Peticion invalida" }, { status: 400 });
  }

  const userId = body.userId;
  const active = body.active;
  if (typeof userId !== "string" || typeof active !== "boolean") {
    return NextResponse.json({ error: "Peticion invalida" }, { status: 400 });
  }

  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No has iniciado sesion" }, { status: 401 });
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!me || me.is_admin !== true) {
    return NextResponse.json(
      { error: "Solo un administrador puede cambiar accesos" },
      { status: 403 }
    );
  }

  if (userId === user.id) {
    return NextResponse.json(
      { error: "No puedes quitarte el acceso a ti mismo" },
      { status: 400 }
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Falta la variable SUPABASE_SERVICE_ROLE_KEY en Vercel" },
      { status: 500 }
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : FOREVER,
  });
  if (banError) {
    return NextResponse.json({ error: banError.message }, { status: 500 });
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ active })
    .eq("id", userId);
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
