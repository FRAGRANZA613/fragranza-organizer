// /pipeline — server component. Loads every deal and its notes, then hands
// them to the SalesPipeline client.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { SalesPipeline } from "@/components/SalesPipeline";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: deals }, { data: notes }] = await Promise.all([
    supabase
      .from("deals")
      .select("*")
      .order("sort", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("deal_notes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  return (
    <SalesPipeline
      initialDeals={deals ?? []}
      initialNotes={notes ?? []}
      currentUser={user.email ?? ""}
    />
  );
}
