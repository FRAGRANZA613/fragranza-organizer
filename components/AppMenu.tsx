"use client";

// The app bar that sits on top of every signed-in page, with a slide-out
// drawer holding every section. Rendered once from the root layout, so adding
// a section later means adding one line to SECTIONS below.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  CalendarClock,
  Home,
  LogOut,
  Menu,
  Navigation,
  Tag,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { LogoSvg } from "@/components/LogoSvg";

type Section = {
  href: string;
  label: string;
  icon: typeof Home;
};

const SECTIONS: Section[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/scents", label: "Scent Scheduler", icon: CalendarClock },
  { href: "/precios", label: "Precios", icon: Tag },
  { href: "/ruta", label: "Ruta", icon: Navigation },
  { href: "/cajas", label: "Cajas", icon: Boxes },
  { href: "/pipeline", label: "Pipeline", icon: TrendingUp },
];

/** Pages that are their own thing and get no app bar. */
const HIDDEN_ON = ["/login", "/auth"];

export function AppMenu({ email }: { email: string }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  const hidden = !email || HIDDEN_ON.some((p) => pathname.startsWith(p));

  /* Close on Escape, and keep the page behind from scrolling while open. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* Any navigation closes the drawer. */
  useEffect(() => { setOpen(false); }, [pathname]);

  if (hidden) return null;

  const current =
    SECTIONS.find((s) => s.href !== "/" && pathname.startsWith(s.href)) ??
    SECTIONS[0];

  return (
    <>
      {/* app bar — sticky, so it keeps its place in the flow and no page
          needs extra top padding to clear it */}
      <header className="sticky top-0 z-40 border-b border-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <LogoSvg className="h-7 w-auto" />
          <span className="text-xs uppercase tracking-widest text-gray-400">
            {current.label === "Inicio" ? "Organizer" : current.label}
          </span>
          <button
            onClick={() => setOpen(true)}
            aria-label="Abrir menú"
            className="ml-auto rounded-lg border border-border p-2 hover:bg-gray-50"
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      {/* drawer */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <nav className="ml-auto flex h-full w-72 max-w-[85%] flex-col bg-white shadow-xl">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <LogoSvg className="h-7 w-auto" />
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar menú"
                className="ml-auto rounded-lg p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {SECTIONS.map((s) => {
                const active =
                  s.href === "/" ? pathname === "/" : pathname.startsWith(s.href);
                const Icon = s.icon;
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium ${
                      active ? "bg-gray-100 text-ink" : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Icon size={18} className={active ? "" : "text-gray-400"} />
                    {s.label}
                  </Link>
                );
              })}

              {pathname === "/" && (
                <button
                  onClick={() => {
                    setOpen(false);
                    window.dispatchEvent(new Event("fragranza:team"));
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  <Users size={18} className="text-gray-400" />
                  Equipo
                </button>
              )}
            </div>

            <div className="border-t border-border p-4">
              <p className="truncate text-xs text-gray-500">{email}</p>
              <form action="/auth/signout" method="post" className="mt-2">
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <LogOut size={15} /> Cerrar sesión
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
