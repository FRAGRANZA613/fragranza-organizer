// Home page — server component. Fetches the current user, the existing items,
// and the team-member list (profiles), then hands them to the Organizer client.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Organizer } from "@/components/Organizer";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: items }, { data: members }, { data: invoices }] = await Promise.all([
    supabase
      .from("items")
      .select("*")
      .order("due", { ascending: true, nullsFirst: false }),
    supabase
      .from("profiles")
      .select("id, email, display_name")
      .order("email", { ascending: true }),
    supabase
      .from("invoices")
      .select("*")
      .order("due_date", { ascending: true, nullsFirst: false }),
  ]);

  return (
    <Organizer
      initialItems={items ?? []}
      initialMembers={members ?? []}
      initialInvoices={invoices ?? []}
      currentUser={{
        id: user.id,
        email: user.email ?? "",
      }}
    />
  );
}
