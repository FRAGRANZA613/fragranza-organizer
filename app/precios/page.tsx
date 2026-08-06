// /precios — server component. Fetches every logged competitor price
// observation, then hands them to the PriceComparison client.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PriceComparison } from "@/components/PriceComparison";

export const dynamic = "force-dynamic";

export default async function PreciosPage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: entries } = await supabase
    .from("price_entries")
    .select("*")
    .order("checked_on", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <PriceComparison
      initialEntries={entries ?? []}
      currentUser={user.email ?? ""}
    />
  );
}
