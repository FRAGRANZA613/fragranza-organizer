"use client";

// Pipeline de ventas — a board of deals from first contact to closed, the
// calls due today, and a note log per deal. Shared across the team in
// realtime, like the rest of the app.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Phone,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ types */

export type Stage =
  | "prospecto" | "contactado" | "cotizacion"
  | "negociacion" | "por_cerrar" | "ganado" | "perdido";

export type Deal = {
  id: string;
  contact: string;
  company: string;
  phone: string;
  email: string;
  value_usd: number;
  client_type: string;
  products: string;
  stage: Stage;
  probability: number;
  priority: "alta" | "media" | "baja";
  next_step: string;
  follow_up_on: string | null;
  expected_close_on: string | null;
  lost_reason: string;
  closed_on: string | null;
  sort: number;
  owner: string;
  created_at: string;
};

export type DealNote = {
  id: string;
  deal_id: string;
  body: string;
  author: string;
  created_at: string;
};

const OPEN_STAGES: Stage[] = [
  "prospecto", "contactado", "cotizacion", "negociacion", "por_cerrar",
];
const CLOSED_STAGES: Stage[] = ["ganado", "perdido"];

const STAGE_LABEL: Record<Stage, string> = {
  prospecto: "Prospecto",
  contactado: "Contactado",
  cotizacion: "Cotización enviada",
  negociacion: "Negociación",
  por_cerrar: "Por cerrar",
  ganado: "Ganado",
  perdido: "Perdido",
};

const LOST_REASONS = [
  "Precio", "Tiempo / no era el momento", "Se fue con la competencia",
  "Sin respuesta", "No era el cliente adecuado", "Otro",
];

const PRIORITY_CLASS: Record<Deal["priority"], string> = {
  alta: "bg-red-50 text-red-700",
  media: "bg-amber-50 text-amber-800",
  baja: "bg-neutral-100 text-neutral-600",
};

/* ------------------------------------------------------------- utilities */

const norm = (s: string | null | undefined) =>
  (s ?? "").toString().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const money = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Whole days from today to an ISO date; negative means overdue. */
function daysAway(iso: string | null): number | null {
  if (!iso) return null;
  const a = new Date(todayISO() + "T00:00:00");
  const b = new Date(iso.slice(0, 10) + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function dueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = daysAway(iso);
  if (d === null) return null;
  if (d < 0) return `HACE ${Math.abs(d)} D${Math.abs(d) === 1 ? "ÍA" : "ÍAS"}`;
  if (d === 0) return "HOY";
  if (d === 1) return "MAÑANA";
  if (d <= 7) return `EN ${d} DÍAS`;
  const [, m, day] = iso.slice(0, 10).split("-");
  const months = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${Number(day)} ${months[Number(m) - 1] ?? ""}`.toUpperCase();
}

const emptyDeal = (user: string): Partial<Deal> => ({
  contact: "", company: "", phone: "", email: "",
  value_usd: 0, client_type: "", products: "",
  stage: "prospecto", probability: 10, priority: "media",
  next_step: "", follow_up_on: null, expected_close_on: null,
  lost_reason: "", owner: user,
});

/* ------------------------------------------------------------- component */

export function SalesPipeline({
  initialDeals,
  initialNotes,
  currentUser,
}: {
  initialDeals: Deal[];
  initialNotes: DealNote[];
  currentUser: string;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [notes, setNotes] = useState<DealNote[]>(initialNotes);
  const [query, setQuery] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState<Deal | null>(null);
  const [form, setForm] = useState<Partial<Deal> | null>(null);
  const [panelTab, setPanelTab] = useState<"detalles" | "notas">("detalles");
  const [noteDraft, setNoteDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  /* ------------------------------------------------------------- refresh */

  const refresh = useCallback(async () => {
    const [{ data: d }, { data: n }] = await Promise.all([
      supabase.from("deals").select("*")
        .order("sort", { ascending: true }).order("created_at", { ascending: true }),
      supabase.from("deal_notes").select("*")
        .order("created_at", { ascending: false }).limit(500),
    ]);
    if (d) setDeals(d as Deal[]);
    if (n) setNotes(n as DealNote[]);
  }, [supabase]);

  useEffect(() => {
    const ch = supabase
      .channel("pipeline_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" },
        () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "deal_notes" },
        () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, refresh]);

  /* ------------------------------------------------------------- derived */

  const visible = useMemo(() => {
    const q = norm(query);
    if (!q) return deals;
    return deals.filter((d) =>
      norm(d.contact).includes(q) || norm(d.company).includes(q) ||
      norm(d.products).includes(q) || norm(d.next_step).includes(q));
  }, [deals, query]);

  const openDeals = useMemo(
    () => deals.filter((d) => OPEN_STAGES.includes(d.stage)),
    [deals],
  );

  const stats = useMemo(() => {
    const total = openDeals.reduce((s, d) => s + Number(d.value_usd), 0);
    const weighted = openDeals.reduce(
      (s, d) => s + (Number(d.value_usd) * Number(d.probability)) / 100, 0);
    const closing = deals.filter((d) => d.stage === "por_cerrar").length;
    const calls = openDeals.filter((d) => {
      const n = daysAway(d.follow_up_on);
      return n !== null && n <= 0;
    }).length;
    return { total, weighted, closing, calls };
  }, [openDeals, deals]);

  /** Deals with a follow-up due within the next two days, soonest first. */
  const callStrip = useMemo(
    () =>
      openDeals
        .filter((d) => {
          const n = daysAway(d.follow_up_on);
          return n !== null && n <= 2;
        })
        .sort((a, b) => (daysAway(a.follow_up_on) ?? 0) - (daysAway(b.follow_up_on) ?? 0)),
    [openDeals],
  );

  const byStage = useCallback(
    (s: Stage) => visible.filter((d) => d.stage === s),
    [visible],
  );

  /* -------------------------------------------------------------- actions */

  async function setStage(deal: Deal, stage: Stage) {
    if (stage === deal.stage) return;

    let lost_reason = deal.lost_reason;
    if (stage === "perdido") {
      const picked = window.prompt(
        `¿Por qué se perdió?\n\n${LOST_REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nEscribe el número o tu propio motivo:`,
        "",
      );
      if (picked === null) return;
      const n = Number(picked.trim());
      lost_reason = Number.isInteger(n) && n >= 1 && n <= LOST_REASONS.length
        ? LOST_REASONS[n - 1]
        : picked.trim();
    }

    const closed = stage === "ganado" || stage === "perdido";
    setBusy(true);
    const { error } = await supabase.from("deals").update({
      stage,
      lost_reason: stage === "perdido" ? lost_reason : "",
      closed_on: closed ? todayISO() : null,
      probability: stage === "ganado" ? 100 : stage === "perdido" ? 0 : deal.probability,
    }).eq("id", deal.id);
    if (error) setNotice(error.message);
    await refresh();
    setBusy(false);
  }

  function openPanel(d: Deal) {
    setOpen(d);
    setForm({ ...d });
    setPanelTab("detalles");
    setNoteDraft("");
  }

  function openNew() {
    setOpen(null);
    setForm(emptyDeal(currentUser));
    setPanelTab("detalles");
    setNoteDraft("");
  }

  async function saveForm() {
    if (!form) return;
    if (!String(form.contact ?? "").trim()) {
      setNotice("El deal necesita al menos un nombre de contacto.");
      return;
    }
    setBusy(true);
    setNotice("");
    const row = {
      contact: String(form.contact ?? "").trim(),
      company: String(form.company ?? "").trim(),
      phone: String(form.phone ?? "").trim(),
      email: String(form.email ?? "").trim(),
      value_usd: Number(form.value_usd) || 0,
      client_type: String(form.client_type ?? "").trim(),
      products: String(form.products ?? "").trim(),
      stage: (form.stage ?? "prospecto") as Stage,
      probability: Math.max(0, Math.min(100, Number(form.probability) || 0)),
      priority: (form.priority ?? "media") as Deal["priority"],
      next_step: String(form.next_step ?? "").trim(),
      follow_up_on: form.follow_up_on || null,
      expected_close_on: form.expected_close_on || null,
      owner: String(form.owner ?? currentUser),
    };
    const { error } = open
      ? await supabase.from("deals").update(row).eq("id", open.id)
      : await supabase.from("deals").insert({ ...row, created_by: currentUser });
    if (error) setNotice(error.message);
    else { setForm(null); setOpen(null); }
    await refresh();
    setBusy(false);
  }

  async function removeDeal(d: Deal) {
    if (!window.confirm(`¿Borrar el deal de ${d.contact}? Se borran también sus notas.`)) return;
    await supabase.from("deals").delete().eq("id", d.id);
    setForm(null); setOpen(null);
    await refresh();
  }

  async function addNote() {
    if (!open || !noteDraft.trim()) return;
    await supabase.from("deal_notes").insert({
      deal_id: open.id, body: noteDraft.trim(), author: currentUser,
    });
    setNoteDraft("");
    await refresh();
  }

  /* -------------------------------------------------------------- render */

  const field =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900";
  const label = "mb-1 block text-xs font-semibold text-neutral-500";

  const stagesShown = showClosed ? CLOSED_STAGES : OPEN_STAGES;

  const card = (d: Deal) => {
    const due = dueLabel(d.follow_up_on);
    const overdue = (daysAway(d.follow_up_on) ?? 1) <= 0;
    return (
      <div
        key={d.id}
        draggable
        onDragStart={() => setDragId(d.id)}
        onDragEnd={() => setDragId(null)}
        onClick={() => openPanel(d)}
        className={`cursor-pointer rounded-lg border bg-white p-3 transition hover:border-neutral-400 ${
          dragId === d.id ? "opacity-40" : "border-neutral-200"
        }`}
      >
        <p className="text-sm font-semibold leading-tight">{d.contact}</p>
        {d.company && <p className="text-xs text-neutral-500">{d.company}</p>}

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_CLASS[d.priority]}`}>
            {d.priority}
          </span>
          {due && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              overdue ? "bg-red-50 text-red-700" : "bg-neutral-100 text-neutral-600"
            }`}>
              {due}
            </span>
          )}
          {Number(d.value_usd) > 0 && (
            <span className="ml-auto text-xs font-semibold tabular-nums">{money(d.value_usd)}</span>
          )}
        </div>

        {d.next_step && (
          <div className="mt-2 border-t border-neutral-100 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Next step</p>
            <p className="text-xs text-neutral-700">{d.next_step}</p>
          </div>
        )}

        {d.stage === "perdido" && d.lost_reason && (
          <p className="mt-2 text-xs italic text-neutral-500">Motivo: {d.lost_reason}</p>
        )}

        {OPEN_STAGES.includes(d.stage) && (
          <div className="mt-2 h-1 w-full rounded bg-neutral-100">
            <div className="h-1 rounded bg-neutral-800" style={{ width: `${d.probability}%` }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-12 pt-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/" className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900">
          <ArrowLeft size={16} /> Inicio
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          {[
            { n: money(stats.total), l: "pipeline abierto" },
            { n: money(stats.weighted), l: "ponderado" },
            { n: String(stats.closing), l: "por cerrar" },
            { n: String(stats.calls), l: "llamadas hoy" },
          ].map((s) => (
            <div key={s.l} className="text-right">
              <div className="text-lg font-semibold leading-none tabular-nums">{s.n}</div>
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">{s.l}</div>
            </div>
          ))}
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            <Plus size={15} /> Nuevo deal
          </button>
        </div>
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">FRAGRANZA 613</p>
      <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice("")} className="text-amber-700"><X size={15} /></button>
        </div>
      )}

      {/* calls due */}
      {callStrip.length > 0 && !showClosed && (
        <section className="mt-5">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Phone size={14} className="text-red-600" /> Llamar hoy · {callStrip.length}
          </p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {callStrip.map((d) => {
              const overdue = (daysAway(d.follow_up_on) ?? 1) <= 0;
              return (
                <button
                  key={d.id}
                  onClick={() => openPanel(d)}
                  className={`w-72 shrink-0 rounded-xl border p-3 text-left ${
                    overdue ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                    {dueLabel(d.follow_up_on)}
                    {d.stage === "por_cerrar" && " · POR CERRAR"}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold">
                    {d.contact}
                    {d.company && <span className="font-normal text-neutral-600"> · {d.company}</span>}
                  </p>
                  {d.next_step && <p className="mt-1 text-xs text-neutral-700">{d.next_step}</p>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* board controls */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por contacto, empresa, producto o next step…"
            className={`${field} pl-9`}
          />
        </div>
        <button
          onClick={() => setShowClosed((v) => !v)}
          className="shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
        >
          {showClosed
            ? "← Ver pipeline activo"
            : `Ver cerrados (${deals.filter((d) => CLOSED_STAGES.includes(d.stage)).length})`}
        </button>
      </div>

      {/* board */}
      <div className="mt-4 flex gap-3 overflow-x-auto pb-4">
        {stagesShown.map((s) => {
          const items = byStage(s);
          const sum = items.reduce((t, d) => t + Number(d.value_usd), 0);
          return (
            <div
              key={s}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const d = deals.find((x) => x.id === dragId);
                setDragId(null);
                if (d) void setStage(d, s);
              }}
              className="flex w-72 shrink-0 flex-col rounded-xl bg-neutral-100/70 p-2"
            >
              <div className="flex items-baseline gap-2 px-1 pb-2">
                <h2 className={`text-sm font-semibold ${
                  s === "ganado" ? "text-emerald-700"
                  : s === "perdido" ? "text-neutral-500"
                  : s === "por_cerrar" ? "text-red-700" : ""
                }`}>
                  {STAGE_LABEL[s]}
                </h2>
                <span className="rounded bg-white px-1.5 text-xs text-neutral-600">{items.length}</span>
                {sum > 0 && <span className="ml-auto text-xs text-neutral-500">{money(sum)}</span>}
              </div>

              <div className="space-y-2">
                {items.map(card)}
                {items.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-neutral-400">
                    {dragId ? "Suelta aquí" : "Vacío"}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* --------------------------------------------------------- panel */}
      {form && (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-black/40"
          onClick={(e) => e.target === e.currentTarget && setForm(null)}
        >
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6">
            <div className="flex items-center gap-2">
              <h3 className="flex-1 truncate text-lg font-semibold">
                {open ? open.contact : "Nuevo deal"}
              </h3>
              <button onClick={() => setForm(null)} className="text-neutral-400 hover:text-neutral-900">
                <X size={18} />
              </button>
            </div>

            {open && (
              <div className="mt-3 flex gap-4 border-b border-neutral-200 text-sm">
                {([["detalles", "Detalles"], ["notas", `Notas (${notes.filter((n) => n.deal_id === open.id).length})`]] as const)
                  .map(([k, t]) => (
                    <button
                      key={k}
                      onClick={() => setPanelTab(k)}
                      className={`-mb-px border-b-2 pb-2 font-semibold ${
                        panelTab === k ? "border-neutral-900" : "border-transparent text-neutral-500"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
              </div>
            )}

            {(!open || panelTab === "detalles") && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Cliente / contacto</label>
                    <input className={field} value={form.contact ?? ""}
                      onChange={(e) => setForm({ ...form, contact: e.target.value })} />
                  </div>
                  <div>
                    <label className={label}>Empresa</label>
                    <input className={field} value={form.company ?? ""}
                      onChange={(e) => setForm({ ...form, company: e.target.value })} />
                  </div>
                  <div>
                    <label className={label}>Teléfono / WhatsApp</label>
                    <input className={field} value={form.phone ?? ""}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div>
                    <label className={label}>Email</label>
                    <input className={field} value={form.email ?? ""}
                      onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div>
                    <label className={label}>Valor estimado (USD)</label>
                    <input className={field} type="number" min="0" value={form.value_usd ?? 0}
                      onChange={(e) => setForm({ ...form, value_usd: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className={label}>Tipo de cliente</label>
                    <input className={field} value={form.client_type ?? ""}
                      placeholder="Hotel, oficina, retail…"
                      onChange={(e) => setForm({ ...form, client_type: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label className={label}>Productos / propuesta</label>
                  <input className={field} value={form.products ?? ""}
                    onChange={(e) => setForm({ ...form, products: e.target.value })} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Etapa</label>
                    <select className={field} value={form.stage ?? "prospecto"}
                      onChange={(e) => setForm({ ...form, stage: e.target.value as Stage })}>
                      {[...OPEN_STAGES, ...CLOSED_STAGES].map((s) => (
                        <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={label}>Probabilidad (%)</label>
                    <input className={field} type="number" min="0" max="100"
                      value={form.probability ?? 0}
                      onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })} />
                  </div>
                </div>

                <div>
                  <label className={label}>Prioridad</label>
                  <div className="flex overflow-hidden rounded-lg border border-neutral-300">
                    {(["alta", "media", "baja"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setForm({ ...form, priority: p })}
                        className={`flex-1 px-3 py-2 text-sm font-semibold capitalize ${
                          form.priority === p ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-100"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Próximo follow-up</label>
                    <input className={field} type="date" value={form.follow_up_on ?? ""}
                      onChange={(e) => setForm({ ...form, follow_up_on: e.target.value || null })} />
                  </div>
                  <div>
                    <label className={label}>Cierre esperado</label>
                    <input className={field} type="date" value={form.expected_close_on ?? ""}
                      onChange={(e) => setForm({ ...form, expected_close_on: e.target.value || null })} />
                  </div>
                </div>

                <div>
                  <label className={label}>Next step</label>
                  <input className={field} value={form.next_step ?? ""}
                    placeholder="Qué tienes que hacer tú, concreto"
                    onChange={(e) => setForm({ ...form, next_step: e.target.value })} />
                </div>

                {open && OPEN_STAGES.includes(open.stage) && (
                  <div className="flex gap-2 border-t border-neutral-100 pt-3">
                    <button
                      onClick={() => { void setStage(open, "ganado"); setForm(null); }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      <Check size={15} /> Ganado
                    </button>
                    <button
                      onClick={() => { void setStage(open, "perdido"); setForm(null); }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
                    >
                      <X size={15} /> Perdido
                    </button>
                  </div>
                )}

                {open?.stage === "perdido" && open.lost_reason && (
                  <p className="text-sm text-neutral-500">Motivo de pérdida: <b>{open.lost_reason}</b></p>
                )}
              </div>
            )}

            {open && panelTab === "notas" && (
              <div className="mt-4">
                <label className={label}>Agregar nota</label>
                <textarea
                  className={`${field} h-20 resize-none`}
                  value={noteDraft}
                  placeholder="Qué pasó en la llamada, qué dijo el cliente…"
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
                <button
                  onClick={() => void addNote()}
                  disabled={!noteDraft.trim()}
                  className="mt-2 w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
                >
                  Agregar
                </button>

                <p className={`${label} mt-5`}>Historial</p>
                <ul className="space-y-3">
                  {notes.filter((n) => n.deal_id === open.id).map((n) => (
                    <li key={n.id} className="border-b border-neutral-100 pb-3 last:border-b-0">
                      <p className="font-mono text-[11px] text-neutral-400">
                        {new Date(n.created_at).toLocaleString("es-PA")}
                        {n.author && ` · ${n.author}`}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm">{n.body}</p>
                    </li>
                  ))}
                  {notes.filter((n) => n.deal_id === open.id).length === 0 && (
                    <li className="text-sm text-neutral-400">Todavía no hay notas.</li>
                  )}
                </ul>
              </div>
            )}

            <div className="mt-6 flex items-center gap-2 border-t border-neutral-100 pt-4">
              {open && (
                <button
                  onClick={() => void removeDeal(open)}
                  className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} /> Borrar
                </button>
              )}
              <button onClick={() => setForm(null)}
                className="ml-auto rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-50">
                Cancelar
              </button>
              <button onClick={() => void saveForm()} disabled={busy}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50">
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* mobile hint */}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400">
        <ArrowRight size={12} /> Arrastra una tarjeta a otra columna para cambiarle la etapa,
        o ábrela y cámbiala desde el panel.
      </p>
    </main>
  );
}
