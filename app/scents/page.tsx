// /scents — server component. Fetches the current month, the recurring
// service stops, and any archived history, then hands them to the
// ScentScheduler client.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ScentScheduler } from "@/components/ScentScheduler";

export const dynamic = "force-dynamic";

export default async function ScentsPage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: clients }, { data: stateRow }, { data: history }] = await Promise.all([
    supabase
      .from("scent_clients")
      .select("*")
      .order("week", { ascending: true })
      .order("day", { ascending: true })
      .order("time", { ascending: true }),
    supabase.from("scent_state").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("scent_history")
      .select("*")
      .order("archived_at", { ascending: false })
      .limit(24),
  ]);

  return (
    <ScentScheduler
      initialClients={clients ?? []}
      initialMonth={stateRow?.current_month ?? ""}
      initialHistory={history ?? []}
    />
  );
}
