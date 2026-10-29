import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieSetItem = { name: string; value: string; options: CookieOptions };

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet: CookieSetItem[]) {
          toSet.forEach(({ name, value }: CookieSetItem) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }: CookieSetItem) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const url = request.nextUrl;

  /** Redirect that keeps whatever cookies Supabase just refreshed. */
  const redirectTo = (pathname: string, search = "") => {
    const target = url.clone();
    target.pathname = pathname;
    target.search = search;
    const res = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  // A quien le quitaron el acceso lo sacamos en el acto, sin esperar a que
  // caduque su sesion. profiles.active es el espejo del bloqueo en auth.
  if (user && !url.pathname.startsWith("/auth")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("active")
      .eq("id", user.id)
      .maybeSingle();

    if (profile && profile.active === false) {
      await supabase.auth.signOut();
      return redirectTo("/login", "?sin-acceso=1");
    }
  }

  // Anyone hitting / when not signed in goes to /login.
  if (!user && url.pathname === "/") {
    return redirectTo("/login");
  }
  // Already-signed-in users hitting /login go home.
  if (user && url.pathname === "/login") {
    return redirectTo("/");
  }

  return response;
}
