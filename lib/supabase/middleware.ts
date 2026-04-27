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

  // Anyone hitting / when not signed in goes to /login.
  if (!user && url.pathname === "/") {
    const redirect = url.clone();
    redirect.pathname = "/login";
    return NextResponse.redirect(redirect);
  }
  // Already-signed-in users hitting /login go home.
  if (user && url.pathname === "/login") {
    const redirect = url.clone();
    redirect.pathname = "/";
    return NextResponse.redirect(redirect);
  }

  return response;
}
