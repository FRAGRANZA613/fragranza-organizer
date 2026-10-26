import type { Metadata } from "next";
import "./globals.css";
import { supabaseServer } from "@/lib/supabase/server";
import { AppMenu } from "@/components/AppMenu";

export const metadata: Metadata = {
  title: "Fragranza Organizer",
  description: "Shared workspace for tasks, meetings and to-dos.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The app bar lives here so every section gets it, including ones added
  // later. AppMenu hides itself when there is no session or on /login.
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="es">
      <body>
        <AppMenu email={user?.email ?? ""} />
        {children}
      </body>
    </html>
  );
}
