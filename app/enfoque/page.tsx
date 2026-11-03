// /enfoque — server component. Carga los mismos pendientes del organizador
// y se los pasa al tablero de enfoque.
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

  const { data: items } = await supabase
    .from("items")
    .select(
      "id, title, type, priority, status, due, notes, assignee, created_by, category, urgent, focus_on"
    )
    .order("due", { ascending: true, nullsFirst: false });

  return (
    <FocusBoard
      initialItems={items ?? []}
      currentUser={{ id: user.id, email: user.email ?? "" }}
    />
  );
}
