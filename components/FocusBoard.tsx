"use client";

// Enfoque 613 — la misma lista de pendientes del organizador, vista por
// importancia. Arriba solo caben tres cosas: lo que te toca hoy. Todo lo
// demas queda abajo, ordenado, esperando su turno.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  AlarmClock,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Zap,
} from "lucide-react";

export interface FocusItem {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  due: string | null;
  notes: string | null;
  assignee: string | null;
  created_by: string | null;
  category: string;
  urgent: boolean;
  focus_on: string | null;
}

interface Props {
  initialItems: FocusItem[];
  currentUser: { id: string; email: string };
}

type Category = {
  key: string;
  label: string;
  emoji: string;
  rank: number;
  /** Aparcado: siempre al fondo y nunca lo elige el botón automático. */
  parked?: boolean;
};

/** El orden de esta lista ES la regla de prioridad. Dinero primero. */
const CATEGORIES: Category[] = [
  { key: "cerrar", label: "Cerrar venta", emoji: "💰", rank: 1 },
  { key: "cobrar", label: "Cobrar", emoji: "💵", rank: 2 },
  { key: "distribuidor", label: "Distribuidor", emoji: "🤝", rank: 3 },
  { key: "vip", label: "Cliente VIP", emoji: "⭐", rank: 4 },
  { key: "seguimiento", label: "Seguimiento", emoji: "🔁", rank: 5 },
  { key: "instalacion", label: "Instalación", emoji: "🔧", rank: 6 },
  { key: "operativo", label: "Operativo", emoji: "📦", rank: 7 },
  { key: "otro", label: "Otro", emoji: "•", rank: 8 },
  { key: "algun_dia", label: "Algún día", emoji: "💡", rank: 9, parked: true },
];

/** Cuántos pendientes caben en el día. */
const MAX_TODAY = 10;

const CAT = new Map(CATEGORIES.map((c) => [c.key, c]));
function cat(key: string): Category {
  return CAT.get(key) ?? CATEGORIES[CATEGORIES.length - 1];
}

/* ------------------------------------------------------------ fechas */

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
const today = () => isoDay(new Date());
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDay(d);
}

/** "vence hoy", "3 días tarde", "en 2 días" — o null si no tiene fecha. */
function dueLabel(iso: string | null) {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const a = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const now = new Date();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((a.getTime() - b.getTime()) / 86400000);
  if (days === 0) return { text: "vence hoy", late: true };
  if (days < 0) return { text: `${-days} ${-days === 1 ? "día" : "días"} tarde`, late: true };
  if (days === 1) return { text: "mañana", late: false };
  return { text: `en ${days} días`, late: false };
}

/**
 * Un pendiente elegido para hoy. Si lo elegiste ayer y no lo terminaste,
 * sigue contando: se arrastra en vez de desaparecer al cambiar el día.
 */
function isChosen(it: FocusItem) {
  return !!it.focus_on && it.focus_on <= today();
}

/** Venció antes de hoy. */
function isOverdue(it: FocusItem) {
  if (!it.due) return false;
  const d = new Date(it.due);
  if (Number.isNaN(d.getTime())) return false;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return day < today();
}

/* ------------------------------------------------- regla de prioridad */

/** Menor = más importante. Urgente manda; luego la categoría; luego la fecha. */
function score(it: FocusItem) {
  const c = cat(it.category);
  // Lo aparcado nunca sube, aunque esté marcado urgente.
  const urgent = it.urgent && !c.parked ? 0 : 1;
  const rank = c.rank;
  const due = it.due ? new Date(it.due).getTime() : Number.MAX_SAFE_INTEGER;
  return urgent * 1e15 + rank * 1e13 + Math.min(due, 1e12);
}

/* ------------------------------------------------- google calendar */

function gcalStamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `T${p(d.getHours())}${p(d.getMinutes())}00`
  );
}

/** Un evento suelto para un pendiente. Sin conectar nada: es solo un link. */
function calendarUrl(it: FocusItem) {
  const start = it.due ? new Date(it.due) : new Date();
  if (!it.due || Number.isNaN(start.getTime())) {
    start.setHours(start.getHours() + 1, 0, 0, 0);
  }
  const end = new Date(start.getTime() + 30 * 60000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${cat(it.category).emoji} ${it.title}`,
    dates: `${gcalStamp(start)}/${gcalStamp(end)}`,
    details: it.notes ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** La alarma diaria de las 8:30 para elegir los 3 del día. */
function dailyAlarmUrl() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 30, 0, 0);
  const end = new Date(d.getTime() + 15 * 60000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "🔥 Elegir mis 3 de hoy",
    dates: `${gcalStamp(d)}/${gcalStamp(end)}`,
    details: "Abre Enfoque 613 y elige máximo 3 pendientes para hoy.",
    recur: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/* ================================================================== */

export function FocusBoard({ initialItems, currentUser }: Props) {
  const supabase = supabaseBrowser();

  const [items, setItems] = useState<FocusItem[]>(initialItems);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // alta rápida
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [draft, setDraft] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [draftCat, setDraftCat] = useState("cerrar");
  const [draftUrgent, setDraftUrgent] = useState(false);
  const [adding, setAdding] = useState(false);

  /* ---------------------------------------------------- realtime */
  useEffect(() => {
    const channel = supabase
      .channel("enfoque")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "items" },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as FocusItem;
              return prev.some((i) => i.id === next.id) ? prev : [...prev, next];
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as FocusItem;
              return prev.map((i) => (i.id === next.id ? next : i));
            }
            if (payload.eventType === "DELETE") {
              const old = payload.old as { id: string };
              return prev.filter((i) => i.id !== old.id);
            }
            return prev;
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  /* ------------------------------------------------------ listas */

  const pending = useMemo(
    () => items.filter((i) => i.status !== "done"),
    [items]
  );

  const todays = useMemo(
    () =>
      pending
        .filter(isChosen)
        .sort((a, b) => score(a) - score(b)),
    [pending]
  );

  const rest = useMemo(
    () =>
      pending
        .filter((i) => !isChosen(i))
        .sort((a, b) => score(a) - score(b)),
    [pending]
  );

  const doneToday = useMemo(
    () => items.filter((i) => i.status === "done" && i.focus_on === today()).length,
    [items]
  );

  /** Cuántos quedan en cada categoría, para los chips del filtro. */
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    rest.forEach((i) => {
      m[i.category] = (m[i.category] ?? 0) + 1;
    });
    return m;
  }, [rest]);

  const overdueCount = useMemo(() => rest.filter(isOverdue).length, [rest]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return rest.filter((i) => {
      if (filterCat === "overdue") {
        if (!isOverdue(i)) return false;
      } else if (filterCat !== "all" && i.category !== filterCat) {
        return false;
      }
      if (!q) return true;
      return norm(`${i.title} ${i.notes ?? ""}`).includes(q);
    });
  }, [rest, query, filterCat]);

  const visibleRest = showAll ? filtered : filtered.slice(0, 12);

  /* ----------------------------------------------------- acciones */

  async function patch(id: string, changes: Partial<FocusItem>) {
    setBusy(id);
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...changes } : i))
    );
    const { error } = await supabase.from("items").update(changes).eq("id", id);
    if (error) window.alert(`No se pudo guardar: ${error.message}`);
    setBusy(null);
  }

  async function remove(it: FocusItem) {
    if (!window.confirm(`¿Borrar "${it.title}"? Esto no se puede deshacer.`)) return;
    setBusy(it.id);
    setItems((prev) => prev.filter((i) => i.id !== it.id));
    const { error } = await supabase.from("items").delete().eq("id", it.id);
    if (error) window.alert(`No se pudo borrar: ${error.message}`);
    setEditingId(null);
    setBusy(null);
  }

  function toggleToday(it: FocusItem) {
    if (isChosen(it)) {
      void patch(it.id, { focus_on: null });
      return;
    }
    if (todays.length >= MAX_TODAY) {
      window.alert(
        `Ya tienes ${MAX_TODAY} para hoy. Termina uno o bájalo antes de subir otro — ese es el punto.`
      );
      return;
    }
    void patch(it.id, { focus_on: today() });
  }

  /** Elige por ti los 3 de arriba segun la regla. */
  function pickTopThree() {
    const slots = MAX_TODAY - todays.length;
    if (slots <= 0) return;
    rest
      .filter((it) => !cat(it.category).parked)
      .slice(0, slots)
      .forEach((it) => {
        void patch(it.id, { focus_on: today() });
      });
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setAdding(true);
    const row = {
      title,
      type: "todo",
      priority: draftUrgent ? "high" : "medium",
      status: "not-started",
      notes: draftNote.trim() || null,
      due: draftDue ? new Date(draftDue).toISOString() : null,
      category: draftCat,
      urgent: draftUrgent,
      assignee: currentUser.id,
      created_by: currentUser.id,
    };
    const { data, error } = await supabase.from("items").insert(row).select().single();
    if (error) window.alert(`No se pudo agregar: ${error.message}`);
    else if (data) {
      setItems((prev) =>
        prev.some((i) => i.id === data.id) ? prev : [...prev, data as FocusItem]
      );
      setDraft("");
      setDraftNote("");
      setDraftDue("");
      setDraftUrgent(false);
    }
    setAdding(false);
  }

  /* -------------------------------------------------------- vista */

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-ink">Enfoque 613</h1>
        <p className="mt-1 text-sm text-gray-500">
          {pending.length} pendientes en total. Hoy solo importan{" "}
          {todays.length === 0 ? MAX_TODAY : todays.length}.
          {doneToday > 0 && ` Ya terminaste ${doneToday} hoy.`}
        </p>
      </header>

      {/* ------------------------------------------- mis 3 de hoy */}
      <section className="rounded-2xl border-2 border-accent/30 bg-accent/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-accent-dark">
            <Zap size={15} /> Mis {MAX_TODAY} de hoy
          </h2>
          {todays.length < MAX_TODAY && rest.length > 0 && (
            <button
              onClick={pickTopThree}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-dark"
            >
              Elígelos por mí
            </button>
          )}
        </div>

        {todays.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">
            Nada elegido todavía. Toca la ⭐ en un pendiente de abajo, o deja que
            los elija por ti.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {todays.map((it, i) => (
              <li
                key={it.id}
                className="flex items-start gap-3 rounded-xl bg-white p-3 shadow-sm"
              >
                {editingId === it.id ? (
                  <EditPanel
                    item={it}
                    busy={busy === it.id}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => void remove(it)}
                    onSave={(changes) => {
                      void patch(it.id, changes);
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                <button
                  onClick={() => void patch(it.id, { status: "done" })}
                  disabled={busy === it.id}
                  title="Marcar como hecho"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-gray-300 text-gray-400 hover:border-emerald-500 hover:text-emerald-600"
                >
                  <Check size={15} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink">
                    <span className="mr-1 text-gray-400">{i + 1}.</span>
                    {it.urgent && <span className="mr-1">🚨</span>}
                    {it.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>
                      {cat(it.category).emoji} {cat(it.category).label}
                    </span>
                    <DueChip iso={it.due} />
                    {it.focus_on && it.focus_on < today() && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                        viene de antes
                      </span>
                    )}
                  </div>
                  {it.notes && (
                    <p className="mt-1 whitespace-pre-line text-xs text-gray-600">{it.notes}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <a
                    href={calendarUrl(it)}
                    target="_blank"
                    rel="noreferrer"
                    title="Ponerle alarma en el calendario"
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-ink"
                  >
                    <Bell size={15} />
                  </a>
                  <button
                    onClick={() => void patch(it.id, { focus_on: tomorrow() })}
                    disabled={busy === it.id}
                    title="Pasar a mañana"
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-ink"
                  >
                    <ArrowRight size={15} />
                  </button>
                  <button
                    onClick={() => setEditingId(it.id)}
                    title="Editar"
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-ink"
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}

        <a
          href={dailyAlarmUrl()}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-accent/30 bg-white px-3 py-2 text-xs font-medium text-accent-dark hover:bg-accent/10"
        >
          <AlarmClock size={14} /> Ponerme la alarma diaria de 8:30 AM
        </a>
      </section>

      {/* ------------------------------------------------ alta rápida */}
      <form onSubmit={addItem} className="mt-5 rounded-2xl border border-border bg-white p-4">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="¿Qué tienes que hacer?"
            className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={adding || !draft.trim()}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plus size={15} /> Agregar
          </button>
        </div>
        <textarea
          value={draftNote}
          onChange={(e) => setDraftNote(e.target.value)}
          rows={2}
          placeholder="Detalle: de qué se trata, qué cotización, qué le vas a decir…"
          className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          Para cuándo
          <input
            type="datetime-local"
            value={draftDue}
            onChange={(e) => setDraftDue(e.target.value)}
            className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setDraftCat(c.key)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                draftCat === c.key
                  ? "border-ink bg-ink text-white"
                  : "border-border text-gray-600 hover:bg-gray-50"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDraftUrgent((v) => !v)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              draftUrgent
                ? "border-red-500 bg-red-500 text-white"
                : "border-border text-gray-600 hover:bg-gray-50"
            }`}
          >
            🚨 Urgente
          </button>
        </div>
      </form>

      {/* --------------------------------------------- todo lo demás */}
      <section className="mt-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Lo demás, por importancia ({filtered.length}
          {filtered.length !== rest.length && ` de ${rest.length}`})
        </h2>

        {/* buscador */}
        <div className="relative mb-2">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por cliente, CUST, cotización o detalle…"
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>

        {/* filtro por categoría, con lo que queda en cada una */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilterCat("all")}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              filterCat === "all"
                ? "border-ink bg-ink text-white"
                : "border-border bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Todos {rest.length}
          </button>
          {overdueCount > 0 && (
            <button
              onClick={() =>
                setFilterCat(filterCat === "overdue" ? "all" : "overdue")
              }
              title="Lo que ya venció"
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                filterCat === "overdue"
                  ? "border-red-600 bg-red-600 text-white"
                  : "border-red-200 bg-white text-red-600 hover:bg-red-50"
              }`}
            >
              ⏰ Atrasados {overdueCount}
            </button>
          )}
          {CATEGORIES.filter((c) => counts[c.key]).map((c) => (
            <button
              key={c.key}
              onClick={() => setFilterCat(filterCat === c.key ? "all" : c.key)}
              title={c.label}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                filterCat === c.key
                  ? "border-ink bg-ink text-white"
                  : "border-border bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {c.emoji} {counts[c.key]}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-xl border border-border bg-white p-4 text-sm text-gray-500">
            {rest.length === 0
              ? "No queda nada más. Buen día."
              : "Nada con ese filtro."}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-white">
            {visibleRest.map((it) => (
              <li key={it.id} className="flex items-start gap-3 px-3 py-2.5">
                {editingId === it.id ? (
                  <EditPanel
                    item={it}
                    busy={busy === it.id}
                    onCancel={() => setEditingId(null)}
                    onDelete={() => void remove(it)}
                    onSave={(changes) => {
                      void patch(it.id, changes);
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                <button
                  onClick={() => toggleToday(it)}
                  disabled={busy === it.id}
                  title="Subir a mis 3 de hoy"
                  className={`mt-0.5 shrink-0 rounded-lg p-1 ${
                    isChosen(it)
                      ? "text-amber-500"
                      : "text-gray-300 hover:text-amber-500"
                  }`}
                >
                  <Star size={17} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">
                    {it.urgent && <span className="mr-1">🚨</span>}
                    {it.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>
                      {cat(it.category).emoji} {cat(it.category).label}
                    </span>
                    <DueChip iso={it.due} />
                  </div>
                  {it.notes && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [it.id]: !prev[it.id] }))
                      }
                      className="mt-1 block w-full text-left text-xs text-gray-600"
                    >
                      {expanded[it.id] ? (
                        <span className="whitespace-pre-line">{it.notes}</span>
                      ) : (
                        <span className="block truncate">{firstLine(it.notes)}</span>
                      )}
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <CategoryPicker
                    value={it.category}
                    onChange={(key) => void patch(it.id, { category: key })}
                  />
                  <button
                    onClick={() => void patch(it.id, { status: "done" })}
                    disabled={busy === it.id}
                    title="Marcar como hecho"
                    className="rounded-lg p-1.5 text-gray-300 hover:bg-gray-100 hover:text-emerald-600"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    onClick={() => setEditingId(it.id)}
                    title="Editar"
                    className="rounded-lg p-1.5 text-gray-300 hover:bg-gray-100 hover:text-ink"
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {filtered.length > 12 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-border bg-white py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            {showAll ? (
              <>
                <ChevronUp size={14} /> Ver solo los 12 más importantes
              </>
            ) : (
              <>
                <ChevronDown size={14} /> Ver los {filtered.length - 12} restantes
              </>
            )}
          </button>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-gray-400">
        La regla: primero el dinero que entra, luego los VIP, después todo lo demás.
      </p>
    </main>
  );
}

/* ------------------------------------------------------- auxiliares */

/** Minúsculas y sin acentos, para que "cotizacion" encuentre "cotización". */
function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** La primera línea del detalle; el resto se ve al tocarlo. */
function firstLine(s: string) {
  const lines = s.split("\n");
  return lines.length > 1 ? `${lines[0]} …` : lines[0];
}

function DueChip({ iso }: { iso: string | null }) {
  const label = dueLabel(iso);
  if (!label) return null;
  return (
    <span className={label.late ? "font-medium text-red-600" : "text-gray-500"}>
      {label.text}
    </span>
  );
}

function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Cambiar la categoría"
      className="rounded-lg border border-border bg-white px-1 py-1 text-xs text-gray-600"
    >
      {CATEGORIES.map((c) => (
        <option key={c.key} value={c.key}>
          {c.emoji}
        </option>
      ))}
    </select>
  );
}

/** ISO → valor de un <input type="datetime-local">, en hora local. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

/**
 * Editor en línea de un pendiente: título, detalle, fecha, categoría,
 * urgencia y borrar. Se abre con el lápiz y ocupa toda la fila.
 */
function EditPanel({
  item,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  item: FocusItem;
  busy: boolean;
  onSave: (changes: Partial<FocusItem>) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [due, setDue] = useState(toLocalInput(item.due));
  const [category, setCategory] = useState(item.category);
  const [urgent, setUrgent] = useState(item.urgent);

  function save() {
    onSave({
      title: title.trim() || item.title,
      notes: notes.trim() || null,
      due: due ? new Date(due).toISOString() : null,
      category,
      urgent,
      priority: urgent ? "high" : "medium",
    });
  }

  return (
    <div className="w-full space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm font-medium"
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder="Detalle: de qué se trata, qué cotización, qué le vas a decir…"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded-lg border border-border px-2 py-1.5 text-xs"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-border px-2 py-1.5 text-xs"
        >
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.emoji} {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setUrgent((v) => !v)}
          className={`rounded-full border px-2.5 py-1 text-xs ${
            urgent
              ? "border-red-500 bg-red-500 text-white"
              : "border-border text-gray-600 hover:bg-gray-50"
          }`}
        >
          🚨 Urgente
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="ml-auto flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 size={13} /> Borrar
        </button>
      </div>
    </div>
  );
}
