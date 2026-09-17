// /ruta — server component. Loads the scent clients (for stop autocomplete),
// this month's mileage totals and the recent routes, then hands them to the
// RefillRoute client.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RefillRoute } from "@/components/RefillRoute";

export const dynamic = "force-dynamic";

export default async function RutaPage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const month = new Date().toISOString().slice(0, 7);

  const [{ data: clients }, { data: mileage }, { data: routes }] = await Promise.all([
    supabase
      .from("scent_clients")
      .select("id, name, address, contact, scents")
      .order("name", { ascending: true }),
    supabase
      .from("mileage_totals")
      .select("*")
      .eq("month", month)
      .order("distance_km", { ascending: false }),
    supabase
      .from("routes")
      .select("*")
      .order("route_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  return (
    <RefillRoute
      clients={clients ?? []}
      initialMileage={mileage ?? []}
      initialRoutes={routes ?? []}
      month={month}
      currentUser={user.email ?? ""}
    />
  );
}
