"use client";

// Main organizer surface. Mirrors the standalone HTML version
// (list + calendar views, type/priority/status, assignee, filters)
// but persists everything through Supabase and syncs live across teammates.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LogoSvg } from "@/components/LogoSvg";

type ItemType = "task" | "meeting" | "todo";
type Priority = "high" | "medium" | "low";
type Status = "not-started" | "in-progress" | "blocked" | "done";

export interface Item {
  id: string;
  title: string;
  type: ItemType;
  priority: Priority;
  status: Status;
  hours: number | null;
  due: string | null; // ISO timestamp
  notes: string | null;
  assignee: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  email: string;
  display_name: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  amount_due: number;
  due_date: string | null; // YYYY-MM-DD
  contact: string;
  notes: string | null;
  paid: boolean;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  initialItems: Item[];
  initialMembers: Member[];
  initialInvoices: Invoice[];
  currentUser: { id: string; email: string };
}

const TYPE_LABEL: Record<ItemType, string> = {
  task: "Task",
  meeting: "Meeting",
  todo: "To-do",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const STATUS_LABEL: Record<Status, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  blocked: "Blocked",
  done: "Done",
};

const PRIORITY_BADGE: Record<Priority, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-emerald-100 text-emerald-700",
};

const STATUS_BADGE: Record<Status, string> = {
  "not-started": "bg-gray-100 text-gray-700",
  "in-progress": "bg-blue-100 text-blue-700",
  blocked: "bg-rose-100 text-rose-700",
  done: "bg-emerald-100 text-emerald-700",
};

const TYPE_BADGE: Record<ItemType, string> = {
  task: "bg-indigo-100 text-indigo-700",
  meeting: "bg-purple-100 text-purple-700",
  todo: "bg-slate-100 text-slate-700",
};

function memberLabel(m: Member | undefined) {
  if (!m) return "Unassigned";
  return m.display_name && m.display_name.trim() ? m.display_name : m.email;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function Organizer({
  initialItems,
  initialMembers,
  initialInvoices,
  currentUser,
}: Props) {
  const supabase = supabaseBrowser();

  const [items, setItems] = useState<Item[]>(initialItems);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);

  const [view, setView] = useState<"list" | "calendar" | "invoices">("list");

  // Invoice form state
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(null);
  const [invFilter, setInvFilter] = useState<"overdue" | "open" | "paid" | "all">("overdue");
  const [iNumber, setINumber] = useState("");
  const [iAmount, setIAmount] = useState("");
  const [iDue, setIDue] = useState("");
  const [iContact, setIContact] = useState("");
  const [iNotes, setINotes] = useState("");
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [filterType, setFilterType] = useState<"all" | ItemType>("all");
  const [filterPriority, setFilterPriority] = useState<"all" | Priority>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | Status>("all");
  const [filterAssignee, setFilterAssignee] = useState<"all" | "me" | string>("all");

  const [calCursor, setCalCursor] = useState<Date>(startOfMonth(new Date()));

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);

  // Form state
  const [fTitle, setFTitle] = useState("");
  const [fType, setFType] = useState<ItemType>("task");
  const [fPriority, setFPriority] = useState<Priority>("medium");
  const [fStatus, setFStatus] = useState<Status>("not-started");
  const [fHours, setFHours] = useState<string>("");
  const [fDue, setFDue] = useState<string>("");
  const [fAssignee, setFAssignee] = useState<string>("");
  const [fNotes, setFNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Member-invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteStatus, setInviteStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [inviteMsg, setInviteMsg] = useState("");

  // ---------------------- Realtime subscription ----------------------
  useEffect(() => {
    const channel = supabase
      .channel("workspace")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "items" },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as Item;
              if (prev.some((i) => i.id === next.id)) return prev;
              return [...prev, next];
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as Item;
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        (payload) => {
          setMembers((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as Member;
              if (prev.some((p) => p.id === next.id)) return prev;
              return [...prev, next];
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as Member;
              return prev.map((p) => (p.id === next.id ? next : p));
            }
            if (payload.eventType === "DELETE") {
              const old = payload.old as { id: string };
              return prev.filter((p) => p.id !== old.id);
            }
            return prev;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "invoices" },
        (payload) => {
          setInvoices((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as Invoice;
              if (prev.some((i) => i.id === next.id)) return prev;
              return [...prev, next];
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as Invoice;
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
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // ---------------------- Filtering ----------------------
  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filterType !== "all" && i.type !== filterType) return false;
      if (filterPriority !== "all" && i.priority !== filterPriority) return false;
      if (filterStatus !== "all" && i.status !== filterStatus) return false;
      if (filterAssignee === "me" && i.assignee !== currentUser.id) return false;
      if (
        filterAssignee !== "all" &&
        filterAssignee !== "me" &&
        i.assignee !== filterAssignee
      )
        return false;
      return true;
    });
  }, [items, filterType, filterPriority, filterStatus, filterAssignee, currentUser.id]);

  const stats = useMemo(() => {
    const total = items.length;
    const open = items.filter((i) => i.status !== "done").length;
    const overdue = items.filter(
      (i) => i.status !== "done" && i.due && new Date(i.due) < new Date()
    ).length;
    const totalHours = items.reduce((s, i) => s + (i.hours ?? 0), 0);
    return { total, open, overdue, totalHours };
  }, [items]);

  // ---------------------- Form handlers ----------------------
  function openNew() {
    setEditId(null);
    setFTitle("");
    setFType("task");
    setFPriority("medium");
    setFStatus("not-started");
    setFHours("");
    setFDue("");
    setFAssignee(currentUser.id);
    setFNotes("");
    setShowForm(true);
  }

  function openEdit(it: Item) {
    setEditId(it.id);
    setFTitle(it.title);
    setFType(it.type);
    setFPriority(it.priority);
    setFStatus(it.status);
    setFHours(it.hours == null ? "" : String(it.hours));
    setFDue(it.due ? it.due.slice(0, 16) : "");
    setFAssignee(it.assignee ?? "");
    setFNotes(it.notes ?? "");
    setShowForm(true);
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!fTitle.trim()) return;
    setSaving(true);
    const payload = {
      title: fTitle.trim(),
      type: fType,
      priority: fPriority,
      status: fStatus,
      hours: fHours === "" ? null : Number(fHours),
      due: fDue ? new Date(fDue).toISOString() : null,
      notes: fNotes.trim() || null,
      assignee: fAssignee || null,
    };
    if (editId) {
      const { error } = await supabase.from("items").update(payload).eq("id", editId);
      if (error) alert(error.message);
    } else {
      const { error } = await supabase
        .from("items")
        .insert({ ...payload, created_by: currentUser.id });
      if (error) alert(error.message);
    }
    setSaving(false);
    setShowForm(false);
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this item?")) return;
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error) alert(error.message);
  }

  async function quickStatus(id: string, status: Status) {
    const { error } = await supabase.from("items").update({ status }).eq("id", id);
    if (error) alert(error.message);
  }

  // ---------------------- Invoice CRUD ----------------------
  function resetInvoiceForm() {
    setEditInvoiceId(null);
    setINumber("");
    setIAmount("");
    setIDue("");
    setIContact("");
    setINotes("");
  }

  function openNewInvoice() {
    resetInvoiceForm();
    setShowInvoiceForm(true);
  }

  function openEditInvoice(inv: Invoice) {
    setEditInvoiceId(inv.id);
    setINumber(inv.invoice_number ?? "");
    setIAmount(inv.amount_due != null ? String(inv.amount_due) : "");
    setIDue(inv.due_date ?? "");
    setIContact(inv.contact ?? "");
    setINotes(inv.notes ?? "");
    setShowInvoiceForm(true);
  }

  async function saveInvoice(e: React.FormEvent) {
    e.preventDefault();
    setSavingInvoice(true);
    const amountNum = Number(iAmount);
    const payload = {
      invoice_number: iNumber.trim(),
      amount_due: Number.isFinite(amountNum) ? amountNum : 0,
      due_date: iDue || null,
      contact: iContact.trim(),
      notes: iNotes.trim() || null,
    };
    if (editInvoiceId) {
      const { error } = await supabase
        .from("invoices")
        .update(payload)
        .eq("id", editInvoiceId);
      setSavingInvoice(false);
      if (error) {
        alert(error.message);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("invoices")
        .insert({ ...payload, created_by: currentUser.id })
        .select()
        .single();
      setSavingInvoice(false);
      if (error) {
        alert(error.message);
        return;
      }
      if (data) setInvoices((prev) => [...prev, data as Invoice]);
    }
    setShowInvoiceForm(false);
    resetInvoiceForm();
  }

  async function deleteInvoice(id: string) {
    if (!confirm("Delete this invoice?")) return;
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) alert(error.message);
  }

  async function togglePaid(inv: Invoice) {
    const next = !inv.paid;
    const { error } = await supabase
      .from("invoices")
      .update({ paid: next, paid_at: next ? new Date().toISOString() : null })
      .eq("id", inv.id);
    if (error) alert(error.message);
  }

  // ---------------------- Member invite ----------------------
  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteStatus("sending");
    setInviteMsg("");
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const { error } = await supabase.auth.signInWithOtp({
      email: inviteEmail.trim(),
      options: { emailRedirectTo: `${siteUrl}/auth/confirm` },
    });
    if (error) {
      setInviteStatus("error");
      setInviteMsg(error.message);
      return;
    }
    setInviteStatus("sent");
    setInviteMsg(`Invite sent to ${inviteEmail.trim()}.`);
    setInviteEmail("");
    setInviteName("");
    setTimeout(() => setInviteStatus("idle"), 4000);
  }

  // ---------------------- Calendar grid ----------------------
  const calendarCells = useMemo(() => {
    const first = startOfMonth(calCursor);
    const startDow = first.getDay(); // 0..6 (Sun)
    const lastDay = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 0).getDate();

    const cells: { date: Date | null; items: Item[] }[] = [];
    for (let i = 0; i < startDow; i++) cells.push({ date: null, items: [] });
    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(calCursor.getFullYear(), calCursor.getMonth(), d);
      const key = ymd(date);
      const dayItems = items.filter((i) => i.due && ymd(new Date(i.due)) === key);
      cells.push({ date, items: dayItems });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, items: [] });
    return cells;
  }, [calCursor, items]);

  const monthLabel = calCursor.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  // ---------------------- Render ----------------------
  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="bg-white border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-ink">
            <LogoSvg className="h-9 w-auto" />
            <span className="text-xs uppercase tracking-widest text-gray-400">
              Organizer
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/scents"
              className="px-3 py-2 rounded-lg border border-border hover:bg-gray-50"
            >
              Scent Scheduler
            </Link>
            <button
              onClick={() => setShowMembers(true)}
              className="px-3 py-2 rounded-lg border border-border hover:bg-gray-50"
            >
              Team
            </button>
            <span className="hidden sm:inline text-gray-500 px-2">
              {currentUser.email}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="px-3 py-2 rounded-lg border border-border hover:bg-gray-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Stat strip */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total", value: stats.total },
            { label: "Open", value: stats.open },
            { label: "Overdue", value: stats.overdue },
            { label: "Total hrs", value: stats.totalHours },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white border border-border rounded-xl p-4"
            >
              <div className="text-xs uppercase text-gray-500 tracking-wide">
                {s.label}
              </div>
              <div className="text-2xl font-semibold text-ink mt-1">{s.value}</div>
            </div>
          ))}
        </section>

        {/* Toolbar */}
        <section className="flex flex-wrap items-center gap-2 mb-4">
          <div className="inline-flex bg-white border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setView("list")}
              className={`px-4 py-2 text-sm ${
                view === "list" ? "bg-accent text-white" : "text-ink hover:bg-gray-50"
              }`}
            >
              List
            </button>
            <button
              onClick={() => setView("calendar")}
              className={`px-4 py-2 text-sm ${
                view === "calendar" ? "bg-accent text-white" : "text-ink hover:bg-gray-50"
              }`}
            >
              Calendar
            </button>
            <button
              onClick={() => setView("invoices")}
              className={`px-4 py-2 text-sm ${
                view === "invoices" ? "bg-accent text-white" : "text-ink hover:bg-gray-50"
              }`}
            >
              Invoices
            </button>
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as "all" | ItemType)}
            className="bg-white border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All types</option>
            <option value="task">Tasks</option>
            <option value="meeting">Meetings</option>
            <option value="todo">To-dos</option>
          </select>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as "all" | Priority)}
            className="bg-white border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "all" | Status)}
            className="bg-white border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="not-started">Not started</option>
            <option value="in-progress">In progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="bg-white border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">Anyone</option>
            <option value="me">Assigned to me</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {memberLabel(m)}
              </option>
            ))}
          </select>

          <div className="flex-1" />
          <button
            onClick={openNew}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white font-semibold text-sm"
          >
            + New item
          </button>
        </section>

        {/* List view */}
        {view === "list" && (
          <section className="bg-white border border-border rounded-xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                Nothing here yet — click <span className="font-semibold">+ New item</span> to add one.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered
                  .slice()
                  .sort((a, b) => {
                    const ad = a.due ? new Date(a.due).getTime() : Infinity;
                    const bd = b.due ? new Date(b.due).getTime() : Infinity;
                    return ad - bd;
                  })
                  .map((it) => {
                    const member = members.find((m) => m.id === it.assignee);
                    const overdue =
                      it.status !== "done" &&
                      it.due &&
                      new Date(it.due) < new Date();
                    return (
                      <li
                        key={it.id}
                        className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-gray-50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[it.type]}`}
                            >
                              {TYPE_LABEL[it.type]}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGE[it.priority]}`}
                            >
                              {PRIORITY_LABEL[it.priority]}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[it.status]}`}
                            >
                              {STATUS_LABEL[it.status]}
                            </span>
                            <span
                              className={`font-medium text-ink truncate ${it.status === "done" ? "line-through text-gray-400" : ""}`}
                            >
                              {it.title}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            {it.due && (
                              <span className={overdue ? "text-red-600 font-medium" : ""}>
                                Due {new Date(it.due).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                                {overdue ? " (overdue)" : ""}
                              </span>
                            )}
                            {it.hours != null && <span>{it.hours} h</span>}
                            <span>· {memberLabel(member)}</span>
                          </div>
                          {it.notes && (
                            <div className="text-sm text-gray-600 mt-1 whitespace-pre-line">
                              {it.notes}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <select
                            value={it.status}
                            onChange={(e) => quickStatus(it.id, e.target.value as Status)}
                            className="text-xs bg-white border border-border rounded-lg px-2 py-1.5"
                          >
                            <option value="not-started">Not started</option>
                            <option value="in-progress">In progress</option>
                            <option value="blocked">Blocked</option>
                            <option value="done">Done</option>
                          </select>
                          <button
                            onClick={() => openEdit(it)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-gray-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteItem(it.id)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-border text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>
        )}

        {/* Calendar view */}
        {view === "calendar" && (
          <section className="bg-white border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setCalCursor(addMonths(calCursor, -1))}
                className="px-3 py-1.5 rounded-lg border border-border hover:bg-gray-50 text-sm"
              >
                ‹
              </button>
              <div className="font-semibold text-ink">{monthLabel}</div>
              <button
                onClick={() => setCalCursor(addMonths(calCursor, 1))}
                className="px-3 py-1.5 rounded-lg border border-border hover:bg-gray-50 text-sm"
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden text-xs">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div
                  key={d}
                  className="bg-gray-50 px-2 py-1 text-gray-500 font-medium text-center"
                >
                  {d}
                </div>
              ))}
              {calendarCells.map((c, idx) => (
                <div
                  key={idx}
                  className={`bg-white min-h-[90px] p-1.5 ${c.date ? "" : "bg-gray-50"}`}
                >
                  {c.date && (
                    <>
                      <div className="text-[11px] text-gray-500 mb-1">
                        {c.date.getDate()}
                      </div>
                      <div className="space-y-1">
                        {c.items.slice(0, 3).map((it) => (
                          <button
                            key={it.id}
                            onClick={() => openEdit(it)}
                            className={`block w-full text-left text-[11px] px-1.5 py-0.5 rounded truncate ${PRIORITY_BADGE[it.priority]} ${it.status === "done" ? "line-through opacity-60" : ""}`}
                            title={it.title}
                          >
                            {it.title}
                          </button>
                        ))}
                        {c.items.length > 3 && (
                          <div className="text-[10px] text-gray-400 px-1">
                            +{c.items.length - 3} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Invoices view */}
        {view === "invoices" && (
          <section className="bg-white border border-border rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-ink">Invoices</h2>
                <div className="inline-flex bg-white border border-border rounded-lg overflow-hidden text-xs">
                  {(["overdue", "open", "paid", "all"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setInvFilter(f)}
                      className={`px-3 py-1.5 capitalize ${
                        invFilter === f
                          ? "bg-accent text-white"
                          : "text-ink hover:bg-gray-50"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={openNewInvoice}
                className="px-3 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90"
              >
                + New invoice
              </button>
            </div>

            {(() => {
              const today = ymd(new Date());
              const filtered = invoices
                .filter((inv) => {
                  if (invFilter === "all") return true;
                  if (invFilter === "paid") return inv.paid;
                  if (invFilter === "open") return !inv.paid;
                  // overdue
                  return !inv.paid && !!inv.due_date && inv.due_date < today;
                })
                .sort((a, b) => {
                  const ad = a.due_date ?? "9999-12-31";
                  const bd = b.due_date ?? "9999-12-31";
                  return ad.localeCompare(bd);
                });

              const totalDue = filtered
                .filter((i) => !i.paid)
                .reduce((sum, i) => sum + Number(i.amount_due ?? 0), 0);

              if (filtered.length === 0) {
                return (
                  <div className="text-sm text-gray-500 py-8 text-center">
                    No invoices in this view.
                  </div>
                );
              }

              return (
                <>
                  <div className="text-xs text-gray-500 mb-2">
                    {filtered.length} invoice{filtered.length === 1 ? "" : "s"} · Outstanding:{" "}
                    <span className="text-ink font-semibold">
                      ${totalDue.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-border">
                          <th className="py-2 pr-3">Invoice #</th>
                          <th className="py-2 pr-3">Due date</th>
                          <th className="py-2 pr-3">Amount due</th>
                          <th className="py-2 pr-3">Contact</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((inv) => {
                          const isOverdue =
                            !inv.paid && !!inv.due_date && inv.due_date < today;
                          return (
                            <tr
                              key={inv.id}
                              className="border-b border-border last:border-0 hover:bg-gray-50"
                            >
                              <td className="py-2 pr-3 font-medium text-ink">
                                {inv.invoice_number || "—"}
                              </td>
                              <td className="py-2 pr-3">
                                <span
                                  className={
                                    isOverdue ? "text-rose-600 font-medium" : "text-ink"
                                  }
                                >
                                  {inv.due_date
                                    ? new Date(inv.due_date + "T00:00:00").toLocaleDateString()
                                    : "—"}
                                </span>
                              </td>
                              <td className="py-2 pr-3 font-medium text-ink">
                                ${Number(inv.amount_due ?? 0).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                              <td className="py-2 pr-3 text-ink">
                                {inv.contact || <span className="text-gray-400">—</span>}
                                {inv.notes && (
                                  <div className="text-xs text-gray-500 mt-0.5 max-w-[280px] truncate">
                                    {inv.notes}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 pr-3">
                                {inv.paid ? (
                                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">
                                    Paid
                                  </span>
                                ) : isOverdue ? (
                                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-rose-100 text-rose-700">
                                    Overdue
                                  </span>
                                ) : (
                                  <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                                    Open
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-3 text-right whitespace-nowrap">
                                <button
                                  onClick={() => togglePaid(inv)}
                                  className="text-xs px-2 py-1 rounded border border-border hover:bg-white mr-1"
                                >
                                  {inv.paid ? "Mark unpaid" : "Mark paid"}
                                </button>
                                <button
                                  onClick={() => openEditInvoice(inv)}
                                  className="text-xs px-2 py-1 rounded border border-border hover:bg-white mr-1"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => deleteInvoice(inv.id)}
                                  className="text-xs px-2 py-1 rounded border border-border text-rose-600 hover:bg-white"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </section>
        )}
      </main>

      {/* Invoice form modal */}
      {showInvoiceForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <form onSubmit={saveInvoice} className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">
                  {editInvoiceId ? "Edit invoice" : "New invoice"}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowInvoiceForm(false);
                    resetInvoiceForm();
                  }}
                  className="text-gray-400 hover:text-ink text-xl leading-none"
                >
                  ×
                </button>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Invoice #
                </label>
                <input
                  type="text"
                  value={iNumber}
                  onChange={(e) => setINumber(e.target.value)}
                  placeholder="INV-1042"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                    Amount due
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={iAmount}
                    onChange={(e) => setIAmount(e.target.value)}
                    placeholder="1250.00"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={iDue}
                    onChange={(e) => setIDue(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Contact for follow-up
                </label>
                <input
                  type="text"
                  value={iContact}
                  onChange={(e) => setIContact(e.target.value)}
                  placeholder="Name, email, or phone"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Notes
                </label>
                <textarea
                  value={iNotes}
                  onChange={(e) => setINotes(e.target.value)}
                  rows={3}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowInvoiceForm(false);
                    resetInvoiceForm();
                  }}
                  className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingInvoice}
                  className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-60"
                >
                  {savingInvoice ? "Saving…" : editInvoiceId ? "Save changes" : "Add invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Item form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <form onSubmit={saveItem} className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">
                  {editId ? "Edit item" : "New item"}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="text-gray-400 hover:text-ink text-xl leading-none"
                >
                  ×
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Title
                </label>
                <input
                  required
                  autoFocus
                  value={fTitle}
                  onChange={(e) => setFTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg"
                  placeholder="What needs to happen?"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Type
                  </label>
                  <select
                    value={fType}
                    onChange={(e) => setFType(e.target.value as ItemType)}
                    className="w-full px-3 py-2 border border-border rounded-lg"
                  >
                    <option value="task">Task</option>
                    <option value="meeting">Meeting</option>
                    <option value="todo">To-do</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Priority
                  </label>
                  <select
                    value={fPriority}
                    onChange={(e) => setFPriority(e.target.value as Priority)}
                    className="w-full px-3 py-2 border border-border rounded-lg"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Status
                  </label>
                  <select
                    value={fStatus}
                    onChange={(e) => setFStatus(e.target.value as Status)}
                    className="w-full px-3 py-2 border border-border rounded-lg"
                  >
                    <option value="not-started">Not started</option>
                    <option value="in-progress">In progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Hours
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={fHours}
                    onChange={(e) => setFHours(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg"
                    placeholder="0"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Due date / time
                  </label>
                  <input
                    type="datetime-local"
                    value={fDue}
                    onChange={(e) => setFDue(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Assignee
                  </label>
                  <select
                    value={fAssignee}
                    onChange={(e) => setFAssignee(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {memberLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Notes
                </label>
                <textarea
                  rows={3}
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg"
                  placeholder="Optional context, links, agenda…"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-lg border border-border hover:bg-gray-50 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white font-semibold text-sm disabled:opacity-60"
                >
                  {saving ? "Saving…" : editId ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Team modal */}
      {showMembers && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">Team</h2>
                <button
                  type="button"
                  onClick={() => setShowMembers(false)}
                  className="text-gray-400 hover:text-ink text-xl leading-none"
                >
                  ×
                </button>
              </div>

              <div>
                <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                  Invite by email
                </h3>
                <form onSubmit={sendInvite} className="space-y-2">
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Name (optional)"
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                  />
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                  />
                  <button
                    type="submit"
                    disabled={inviteStatus === "sending"}
                    className="w-full py-2 bg-accent hover:bg-accent-dark text-white font-semibold rounded-lg text-sm disabled:opacity-60"
                  >
                    {inviteStatus === "sending" ? "Sending…" : "Send magic-link invite"}
                  </button>
                  {inviteMsg && (
                    <p
                      className={`text-xs text-center ${inviteStatus === "error" ? "text-red-600" : "text-emerald-700"}`}
                    >
                      {inviteMsg}
                    </p>
                  )}
                </form>
                <p className="text-xs text-gray-500 mt-2">
                  They'll receive a sign-in email — once they click it, they share this workspace.
                </p>
              </div>

              <div>
                <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                  Members ({members.length})
                </h3>
                <ul className="divide-y divide-border border border-border rounded-lg">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="px-3 py-2 flex items-center justify-between text-sm"
                    >
                      <div>
                        <div className="text-ink font-medium">{memberLabel(m)}</div>
                        {m.display_name && (
                          <div className="text-xs text-gray-500">{m.email}</div>
                        )}
                      </div>
                      {m.id === currentUser.id && (
                        <span className="text-xs text-gray-400">you</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
