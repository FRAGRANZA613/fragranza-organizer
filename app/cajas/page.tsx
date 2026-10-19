// /cajas — server component. Loads the warehouses, the product list, every
// box with its contents and the recent movements, then hands them to the
// BoxWarehouse client.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { BoxWarehouse } from "@/components/BoxWarehouse";

export const dynamic = "force-dynamic";

export default async function CajasPage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: warehouses }, { data: products }, { data: boxes }, { data: movements }] =
    await Promise.all([
      supabase.from("warehouses").select("*").order("sort", { ascending: true }),
      supabase.from("products").select("*").order("name", { ascending: true }),
      supabase
        .from("boxes")
        .select("*, box_items(id, product_id, qty)")
        .order("code", { ascending: true }),
      supabase
        .from("box_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  return (
    <BoxWarehouse
      initialWarehouses={warehouses ?? []}
      initialProducts={products ?? []}
      initialBoxes={boxes ?? []}
      initialMovements={movements ?? []}
      currentUser={user.email ?? ""}
    />
  );
}
