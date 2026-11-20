// /enfoque — server component. Carga los mismos pendientes del organizador
// y los deals con los que están ligados, para que cada tarea muestre cuánto vale.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { FocusBoard } from "@/components/FocusBoard";

export const dynamic = "force-dynamic";

export default async function EnfoquePage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: items }, { data: deals }] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, title, type, priority, status, due, notes, assignee, created_by, category, urgent, focus_on, deal_id"
      )
      .order("due", { ascending: true, nullsFirst: false }),
    supabase.from("deals").select("id, contact, company, value_usd, stage, deal_type"),
  ]);

  return (
    <FocusBoard
      initialItems={items ?? []}
      initialDeals={deals ?? []}
      currentUser={{ id: user.id, email: user.email ?? "" }}
    />
  );
}
