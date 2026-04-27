import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieSetItem = { name: string; value: string; options: CookieOptions };

export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: CookieSetItem[]) {
          try {
            toSet.forEach(({ name, value, options }: CookieSetItem) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component is a no-op.
          }
        },
      },
    }
  );
}
