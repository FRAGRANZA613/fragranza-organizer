// Home page — server component. Arriba, el resumen del día; abajo, el
// organizador de siempre con sus tareas, calendario y facturas.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Organizer } from "@/components/Organizer";
import { TodayBrief, type BriefItem, type BriefCall } from "@/components/TodayBrief";

export const dynamic = "force-dynamic";

/** Hoy en formato YYYY-MM-DD, hora de Panamá. */
function hoyISO() {
  const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export default async function Home() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const hoy = hoyISO();

  const [
    { data: items },
    { data: members },
    { data: invoices },
    { data: enfoque },
    { data: deals },
    { count: atrasados },
  ] = await Promise.all([
    supabase
      .from("items")
      .select("*")
      .order("due", { ascending: true, nullsFirst: false }),
    supabase
      .from("profiles")
      .select("id, email, display_name, active, is_admin")
      .order("email", { ascending: true }),
    supabase
      .from("invoices")
      .select("*")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("items")
      .select("id, title, category, urgent, due, deal_id, action_type, focus_on")
      .neq("status", "done")
      .not("focus_on", "is", null)
      .lte("focus_on", hoy)
      .order("due", { ascending: true, nullsFirst: false }),
    supabase
      .from("deals")
      .select("id, contact, company, value_usd, stage, next_step, follow_up_on")
      .not("stage", "in", "(ganado,perdido)"),
    supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .neq("status", "done")
      .neq("category", "algun_dia")
      .lt("due", new Date().toISOString()),
  ]);

  const dealValue = new Map<string, { value: number; stage: string }>();
  (deals ?? []).forEach((d) =>
    dealValue.set(d.id, { value: Number(d.value_usd ?? 0), stage: d.stage })
  );

  const briefItems: BriefItem[] = (enfoque ?? []).map((i) => {
    const d = i.deal_id ? dealValue.get(i.deal_id) : undefined;
    return {
      id: i.id,
      title: i.title,
      category: i.category,
      urgent: i.urgent,
      due: i.due,
      action_type: i.action_type,
      deal_value: d?.value ?? null,
      deal_stage: d?.stage ?? null,
    };
  });

  const llamarHoy: BriefCall[] = (deals ?? [])
    .filter((d) => d.follow_up_on && d.follow_up_on <= hoy)
    .sort((a, b) => Number(b.value_usd ?? 0) - Number(a.value_usd ?? 0))
    .map((d) => ({
      id: d.id,
      contact: d.contact,
      company: d.company,
      value_usd: Number(d.value_usd ?? 0),
      next_step: d.next_step ?? "",
      follow_up_on: d.follow_up_on,
    }));

  const pendientes = (invoices ?? []).filter((inv) => !inv.paid);
  const porCobrar = {
    total: pendientes.reduce((sum, inv) => sum + Number(inv.amount_due ?? 0), 0),
    cuantas: pendientes.length,
  };

  const nombre =
    (members ?? []).find((m) => m.id === user.id)?.display_name?.split(" ")[0] ?? "";

  return (
    <>
      <div className="px-4 pt-4">
        <TodayBrief
          hoy={briefItems}
          llamarHoy={llamarHoy}
          porCobrar={porCobrar}
          atrasados={atrasados ?? 0}
          nombre={nombre}
        />
      </div>
      <Organizer
        initialItems={items ?? []}
        initialMembers={members ?? []}
        initialInvoices={invoices ?? []}
        currentUser={{
          id: user.id,
          email: user.email ?? "",
        }}
      />
    </>
  );
}
