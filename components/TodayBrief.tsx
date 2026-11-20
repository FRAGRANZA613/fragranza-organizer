// Lo primero que se ve al abrir el organizador: treinta segundos para saber
// qué hacer hoy, sin entrar a Enfoque ni a Pipeline. Es solo lectura — cada
// número lleva a la pantalla donde se trabaja.

import Link from "next/link";
import { AlertTriangle, Banknote, PhoneCall, Zap } from "lucide-react";

export interface BriefItem {
  id: string;
  title: string;
  category: string;
  urgent: boolean;
  due: string | null;
  deal_value: number | null;
  deal_stage: string | null;
  action_type: string;
}

export interface BriefCall {
  id: string;
  contact: string;
  company: string;
  value_usd: number;
  next_step: string;
  follow_up_on: string | null;
}

interface Props {
  hoy: BriefItem[];
  llamarHoy: BriefCall[];
  porCobrar: { total: number; cuantas: number };
  atrasados: number;
  nombre: string;
}

const EMOJI: Record<string, string> = {
  cerrar: "💰",
  cobrar: "💵",
  distribuidor: "🤝",
  vip: "⭐",
  seguimiento: "🔁",
  instalacion: "🔧",
  operativo: "📦",
  otro: "•",
  algun_dia: "💡",
};

/** Cómo se hace el pendiente, para saberlo antes de abrir Enfoque. */
const ACTION_EMOJI: Record<string, string> = {
  llamada: "📞",
  email: "✉️",
  whatsapp: "💬",
  fisico: "🚗",
  otro: "•",
};

function money(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "buenos días" según la hora del servidor, que es la de Panamá. */
function saludo() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

export function TodayBrief({
  hoy,
  llamarHoy,
  porCobrar,
  atrasados,
  nombre,
}: Props) {
  return (
    <section className="mx-auto mb-6 max-w-5xl rounded-2xl border border-border bg-white p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-ink">
        {saludo()}
        {nombre ? `, ${nombre}` : ""}
      </h2>
      <p className="mt-0.5 text-sm text-gray-500">
        {hoy.length > 0
          ? `Hoy te tocan ${hoy.length}.`
          : "No has elegido nada para hoy todavía."}
      </p>

      {/* los tres números que mandan */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Tile
          href="/pipeline"
          icon={<PhoneCall size={14} />}
          label="Llamar hoy"
          value={String(llamarHoy.length)}
          tone={llamarHoy.length > 0 ? "accent" : "flat"}
        />
        <Tile
          href="/"
          icon={<Banknote size={14} />}
          label={`Por cobrar · ${porCobrar.cuantas}`}
          value={porCobrar.total > 0 ? money(porCobrar.total) : "—"}
          tone={porCobrar.total > 0 ? "accent" : "flat"}
        />
        <Tile
          href="/enfoque"
          icon={<AlertTriangle size={14} />}
          label="Atrasados"
          value={String(atrasados)}
          tone={atrasados > 0 ? "red" : "flat"}
        />
      </div>

      {/* lo que elegiste para hoy */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-dark">
            <Zap size={13} /> Lo de hoy
          </h3>
          <Link
            href="/enfoque"
            className="text-xs font-medium text-accent hover:text-accent-dark"
          >
            Abrir Enfoque →
          </Link>
        </div>

        {hoy.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-3 text-sm text-gray-500">
            Entra a Enfoque y elige tus 10. Si no quieres decidir, el botón
            &ldquo;Elígelos por mí&rdquo; los escoge por importancia.
          </p>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {hoy.map((it, i) => (
              <li key={it.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                <span className="w-4 shrink-0 text-right text-gray-400">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink">
                    {it.urgent && "🚨 "}
                    {ACTION_EMOJI[it.action_type] ?? "•"} {it.title}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    {EMOJI[it.category] ?? "•"}
                  </span>
                  {it.deal_value ? (
                    <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
                      {money(it.deal_value)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* a quién hay que llamar, del pipeline */}
      {llamarHoy.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Llamar hoy, del Pipeline
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {llamarHoy.slice(0, 6).map((d) => (
              <li key={d.id} className="px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-ink">
                    {d.contact}
                    {d.company && (
                      <span className="text-gray-500"> · {d.company}</span>
                    )}
                  </span>
                  {d.value_usd > 0 && (
                    <span className="shrink-0 text-xs font-medium text-emerald-700">
                      {money(d.value_usd)}
                    </span>
                  )}
                </div>
                {d.next_step && (
                  <p className="truncate text-xs text-gray-500">{d.next_step}</p>
                )}
              </li>
            ))}
          </ul>
          {llamarHoy.length > 6 && (
            <Link
              href="/pipeline"
              className="mt-1 block text-xs font-medium text-accent hover:text-accent-dark"
            >
              y {llamarHoy.length - 6} más en el Pipeline →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({
  href,
  icon,
  label,
  value,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "accent" | "red" | "flat";
}) {
  const color =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "accent"
        ? "border-accent/30 bg-accent/5 text-accent-dark"
        : "border-border bg-gray-50 text-gray-500";
  return (
    <Link
      href={href}
      className={`rounded-xl border p-2.5 transition hover:brightness-95 ${color}`}
    >
      <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-0.5 block text-xl font-semibold">{value}</span>
    </Link>
  );
}
