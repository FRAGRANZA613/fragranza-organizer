"use client";

// Monthly service-route scheduler. Persists everything through Supabase
// (table public.scent_clients, public.scent_state, public.scent_history;
// proof photos go to the public 'scent-photos' storage bucket) and syncs
// live across devices via realtime postgres_changes.

import { useEffect, useState } from "react";
import {
  Check,
  Plus,
  Trash2,
  MapPin,
  Clock,
  Phone,
  FileText,
  Calendar,
  User,
  X,
  Droplet,
  Camera,
  MessageSquare,
  History,
  Truck,
  Wrench,
  ArrowLeft,
  DollarSign,
  CreditCard,
} from "lucide-react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

// ----------------------------- Types -----------------------------

type ServiceType = "physical" | "shipping";

interface ScentRow {
  scent: string;
  ml: string;
}

interface ScentPhoto {
  id: string;
  path: string;
  url: string;
  uploaded_at: string;
}

export interface ScentClient {
  id: string;
  name: string;
  address: string;
  time: string | null;
  day: string;
  week: number;
  contact: string | null;
  notes: string | null;
  technician: string | null;
  scents: ScentRow[];
  service_type: ServiceType;
  done: boolean;
  completed_at: string | null;
  paid: boolean;
  paid_at: string | null;
  subscription_value: number;
  service_notes: string | null;
  notes_updated_at: string | null;
  tracking: string | null;
  photos: ScentPhoto[];
  created_at: string;
  updated_at: string;
}

export interface HistoryArchive {
  id: string;
  month: string;
  archived_at: string;
  clients: ScentClient[];
}

interface Props {
  initialClients: ScentClient[];
  initialMonth: string;
  initialHistory: HistoryArchive[];
}

// ----------------------------- Helpers -----------------------------

const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function makeMonthString() {
  return new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Compress an image to JPEG <= 1280px on the long edge for upload.
function compressImageToBlob(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1280;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas 2d unavailable"));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
          "image/jpeg",
          0.7,
        );
      };
      img.onerror = () => reject(new Error("image load failed"));
      img.src = (e.target?.result as string) || "";
    };
    reader.onerror = () => reject(new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

// Backward-compatible scent reader (none of our DB rows use the old single-scent
// shape, but keep the helper in case legacy data is migrated in later).
function getScents(c: ScentClient): ScentRow[] {
  if (Array.isArray(c.scents) && c.scents.length > 0) return c.scents;
  return [];
}

function getServiceType(c: ScentClient): ServiceType {
  return c.service_type || "physical";
}

// Tiny UUID helper (avoid crypto.randomUUID() which isn't on every Safari)
function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ----------------------------- Component -----------------------------

export function ScentScheduler({
  initialClients,
  initialMonth,
  initialHistory,
}: Props) {
  const supabase = supabaseBrowser();

  const [clients, setClients] = useState<ScentClient[]>(initialClients);
  const [activeWeek, setActiveWeek] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(
    initialMonth || makeMonthString(),
  );
  const [viewingPhotos, setViewingPhotos] = useState<{
    client: ScentClient;
    index: number;
  } | null>(null);
  const [editingNotesFor, setEditingNotesFor] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [showHistory, setShowHistory] = useState<ScentClient | null>(null);
  const [history, setHistory] = useState<HistoryArchive[]>(initialHistory);

  const [form, setForm] = useState<{
    name: string;
    address: string;
    time: string;
    day: string;
    week: number;
    contact: string;
    notes: string;
    technician: string;
    scents: ScentRow[];
    serviceType: ServiceType;
    subscriptionValue: string;
  }>({
    name: "",
    address: "",
    time: "",
    day: "Monday",
    week: 1,
    contact: "",
    notes: "",
    technician: "Tech 1",
    scents: [{ scent: "", ml: "" }],
    serviceType: "physical",
    subscriptionValue: "",
  });

  // ---------------------- Realtime ----------------------
  useEffect(() => {
    const channel = supabase
      .channel("scent-workspace")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scent_clients" },
        (payload) => {
          setClients((prev) => {
            if (payload.eventType === "INSERT") {
              const next = payload.new as ScentClient;
              if (prev.some((c) => c.id === next.id)) return prev;
              return [...prev, next];
            }
            if (payload.eventType === "UPDATE") {
              const next = payload.new as ScentClient;
              return prev.map((c) => (c.id === next.id ? next : c));
            }
            if (payload.eventType === "DELETE") {
              const old = payload.old as { id: string };
              return prev.filter((c) => c.id !== old.id);
            }
            return prev;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scent_state" },
        (payload) => {
          const next = payload.new as { current_month?: string };
          if (next?.current_month) setCurrentMonth(next.current_month);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scent_history" },
        (payload) => {
          const next = payload.new as HistoryArchive;
          setHistory((prev) => [next, ...prev].slice(0, 24));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // ---------------------- Form helpers ----------------------

  const updateScentRow = (idx: number, field: "scent" | "ml", value: string) => {
    const next = [...form.scents];
    next[idx] = { ...next[idx], [field]: value };
    setForm({ ...form, scents: next });
  };

  const addScentRow = () => {
    setForm({ ...form, scents: [...form.scents, { scent: "", ml: "" }] });
  };

  const removeScentRow = (idx: number) => {
    if (form.scents.length === 1) {
      setForm({ ...form, scents: [{ scent: "", ml: "" }] });
    } else {
      setForm({ ...form, scents: form.scents.filter((_, i) => i !== idx) });
    }
  };

  // ---------------------- CRUD ----------------------

  const addClient = async () => {
    if (!form.name.trim() || !form.address.trim()) return;
    const cleanScents = form.scents.filter((s) => s.scent.trim() || s.ml);
    const insertRow = {
      name: form.name.trim(),
      address: form.address.trim(),
      time: form.time || null,
      day: form.day,
      week: form.week,
      contact: form.contact,
      notes: form.notes,
      technician: form.technician,
      scents: cleanScents,
      service_type: form.serviceType,
      done: false,
      completed_at: null,
      paid: false,
      paid_at: null,
      subscription_value: (() => {
        const n = Number(form.subscriptionValue);
        return Number.isFinite(n) && n > 0 ? n : 0;
      })(),
      service_notes: "",
      notes_updated_at: null,
      tracking: "",
      photos: [],
    };
    const { data, error } = await supabase
      .from("scent_clients")
      .insert(insertRow)
      .select()
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    if (data) {
      setClients((prev) =>
        prev.some((c) => c.id === data.id) ? prev : [...prev, data as ScentClient],
      );
    }
    setForm({
      name: "",
      address: "",
      time: "",
      day: "Monday",
      week: activeWeek,
      contact: "",
      notes: "",
      technician: "Tech 1",
      scents: [{ scent: "", ml: "" }],
      serviceType: "physical",
      subscriptionValue: "",
    });
    setShowForm(false);
  };

  const toggleDone = async (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    const nextDone = !c.done;
    const patch = {
      done: nextDone,
      completed_at: nextDone ? new Date().toISOString() : null,
    };
    setClients((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase
      .from("scent_clients")
      .update(patch)
      .eq("id", id);
    if (error) alert(error.message);
  };

  const togglePaid = async (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    const nextPaid = !c.paid;
    const patch = {
      paid: nextPaid,
      paid_at: nextPaid ? new Date().toISOString() : null,
    };
    setClients((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase
      .from("scent_clients")
      .update(patch)
      .eq("id", id);
    if (error) alert(error.message);
  };

  const deleteClient = async (id: string) => {
    if (!confirm("Delete this stop? This cannot be undone.")) return;
    const c = clients.find((x) => x.id === id);
    setClients((prev) => prev.filter((x) => x.id !== id));
    const { error } = await supabase.from("scent_clients").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    // Best-effort cleanup of orphaned photos in storage
    const paths = (c?.photos || []).map((p) => p.path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from("scent-photos").remove(paths);
    }
  };

  const uploadPhotos = async (clientId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newPhotos: ScentPhoto[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const blob = await compressImageToBlob(file);
        const path = `${clientId}/${uid()}.jpg`;
        const { error } = await supabase.storage
          .from("scent-photos")
          .upload(path, blob, { contentType: "image/jpeg" });
        if (error) {
          console.error(error);
          continue;
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from("scent-photos").getPublicUrl(path);
        newPhotos.push({
          id: uid(),
          path,
          url: publicUrl,
          uploaded_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error("photo upload failed", e);
      }
    }
    if (newPhotos.length === 0) return;
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    const updated = [...(c.photos || []), ...newPhotos];
    setClients((prev) =>
      prev.map((x) => (x.id === clientId ? { ...x, photos: updated } : x)),
    );
    const { error } = await supabase
      .from("scent_clients")
      .update({ photos: updated })
      .eq("id", clientId);
    if (error) alert(error.message);
  };

  const removePhoto = async (clientId: string, photoId: string) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return;
    const photo = (c.photos || []).find((p) => p.id === photoId);
    const updated = (c.photos || []).filter((p) => p.id !== photoId);
    setClients((prev) =>
      prev.map((x) => (x.id === clientId ? { ...x, photos: updated } : x)),
    );
    const { error } = await supabase
      .from("scent_clients")
      .update({ photos: updated })
      .eq("id", clientId);
    if (error) {
      alert(error.message);
      return;
    }
    if (photo?.path) {
      await supabase.storage.from("scent-photos").remove([photo.path]);
    }
    // Update viewer if it was open on this client
    if (viewingPhotos?.client.id === clientId) {
      if (updated.length === 0) {
        setViewingPhotos(null);
      } else {
        setViewingPhotos({
          client: { ...viewingPhotos.client, photos: updated },
          index: Math.min(viewingPhotos.index, updated.length - 1),
        });
      }
    }
  };

  const openNotesEditor = (client: ScentClient) => {
    setEditingNotesFor(client.id);
    setNotesDraft(client.service_notes || "");
  };

  const saveServiceNotes = async () => {
    if (!editingNotesFor) return;
    const trimmed = notesDraft.trim();
    const patch = {
      service_notes: trimmed,
      notes_updated_at: trimmed ? new Date().toISOString() : null,
    };
    setClients((prev) =>
      prev.map((x) => (x.id === editingNotesFor ? { ...x, ...patch } : x)),
    );
    const { error } = await supabase
      .from("scent_clients")
      .update(patch)
      .eq("id", editingNotesFor);
    if (error) alert(error.message);
    setEditingNotesFor(null);
    setNotesDraft("");
  };

  const updateTracking = async (id: string, tracking: string) => {
    setClients((prev) => prev.map((x) => (x.id === id ? { ...x, tracking } : x)));
    const { error } = await supabase
      .from("scent_clients")
      .update({ tracking })
      .eq("id", id);
    if (error) alert(error.message);
  };

  const resetMonth = async () => {
    if (clients.length === 0) {
      const now = makeMonthString();
      await supabase.from("scent_state").upsert({ id: 1, current_month: now });
      setCurrentMonth(now);
      return;
    }
    if (
      !confirm(
        `Close out "${currentMonth}" and start a new month?\n\n` +
          `Your client schedule (names, addresses, scents, ml, days, times) will be kept exactly the same.\n\n` +
          `Check marks, photos, and tech notes from this month will be archived to history.`,
      )
    ) {
      return;
    }
    // Archive the closing month's full client roster as a JSONB snapshot.
    const { data: archived, error: archiveErr } = await supabase
      .from("scent_history")
      .insert({ month: currentMonth, clients })
      .select()
      .single();
    if (archiveErr) {
      alert(archiveErr.message);
      return;
    }
    if (archived) {
      setHistory((prev) => [archived as HistoryArchive, ...prev].slice(0, 24));
    }
    // Reset every client row's per-visit fields. We scope by current id list
    // so we never accidentally touch unrelated future tables.
    const ids = clients.map((c) => c.id);
    if (ids.length > 0) {
      const { error: resetErr } = await supabase
        .from("scent_clients")
        .update({
          done: false,
          completed_at: null,
          paid: false,
          paid_at: null,
          photos: [],
          service_notes: "",
          notes_updated_at: null,
          tracking: "",
        })
        .in("id", ids);
      if (resetErr) {
        alert(resetErr.message);
        return;
      }
    }
    // Note: we deliberately do NOT delete the underlying photo files in storage.
    // The archive's `clients` JSONB still references them by URL so techs can
    // look back at past months from the History viewer.
    const now = makeMonthString();
    await supabase.from("scent_state").upsert({ id: 1, current_month: now });
    setCurrentMonth(now);
    // Optimistic local reset (realtime will re-sync but feel instant)
    setClients((prev) =>
      prev.map((c) => ({
        ...c,
        done: false,
        completed_at: null,
        paid: false,
        paid_at: null,
        photos: [],
        service_notes: "",
        notes_updated_at: null,
        tracking: "",
      })),
    );
  };

  // ---------------------- Derived ----------------------

  const weekClients = clients.filter((c) => c.week === activeWeek);
  const onsiteClients = weekClients.filter((c) => getServiceType(c) === "physical");
  const shipmentClients = weekClients.filter((c) => getServiceType(c) === "shipping");

  const grouped = days
    .map((d) => ({
      day: d,
      items: onsiteClients
        .filter((c) => c.day === d)
        .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
    }))
    .filter((g) => g.items.length > 0);

  const supplySummary = weekClients.reduce<
    Record<string, { total: number; stops: number; remaining: number }>
  >((acc, c) => {
    const scents = getScents(c);
    scents.forEach((s) => {
      const key = (s.scent || "").trim();
      if (!key) return;
      if (!acc[key]) acc[key] = { total: 0, stops: 0, remaining: 0 };
      const ml = parseFloat(s.ml) || 0;
      acc[key].total += ml;
      acc[key].stops += 1;
      if (!c.done) acc[key].remaining += ml;
    });
    return acc;
  }, {});
  const supplyEntries = Object.entries(supplySummary).sort(
    (a, b) => b[1].total - a[1].total,
  );

  const totalThisWeek = weekClients.length;
  const doneThisWeek = weekClients.filter((c) => c.done).length;
  const monthTotal = clients.length;
  const monthDone = clients.filter((c) => c.done).length;
  const pct = totalThisWeek
    ? Math.round((doneThisWeek / totalThisWeek) * 100)
    : 0;

  // Subscription revenue rollups
  const monthlyRevenue = clients.reduce(
    (sum, c) => sum + Number(c.subscription_value ?? 0),
    0,
  );
  const collectedRevenue = clients
    .filter((c) => c.paid)
    .reduce((sum, c) => sum + Number(c.subscription_value ?? 0), 0);
  const outstandingRevenue = monthlyRevenue - collectedRevenue;

  // ---------------------- Render ----------------------

  return (
    <div
      className="min-h-screen bg-stone-50"
      style={{ fontFamily: "'Fraunces', Georgia, serif" }}
    >
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700;9..144,900&family=JetBrains+Mono:wght@400;500;600&display=swap");
        .mono {
          font-family: "JetBrains Mono", monospace;
        }
        .stripe-bg {
          background-image: repeating-linear-gradient(
            45deg,
            transparent,
            transparent 12px,
            rgba(20, 20, 20, 0.025) 12px,
            rgba(20, 20, 20, 0.025) 13px
          );
        }
        @keyframes checkPop {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.15);
          }
          100% {
            transform: scale(1);
          }
        }
        .check-pop {
          animation: checkPop 0.3s ease-out;
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .slide-up {
          animation: slideUp 0.25s ease-out;
        }
      `}</style>

      {/* Header */}
      <header className="bg-stone-900 text-stone-50 stripe-bg">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-4">
            <Link
              href="/"
              className="mono text-[10px] uppercase tracking-widest text-stone-400 hover:text-amber-300 flex items-center gap-1.5 transition"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to Organizer
            </Link>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="mono text-[10px] uppercase tracking-widest text-stone-400 hover:text-amber-300 transition"
              >
                Sign Out
              </button>
            </form>
          </div>
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="mono text-xs tracking-[0.3em] text-amber-300 uppercase mb-2">
                Monthly Service Route
              </p>
              <h1
                className="text-4xl md:text-5xl font-light tracking-tight"
                style={{ fontStyle: "italic" }}
              >
                Scent <span className="font-bold not-italic">Scheduler</span>
              </h1>
              <p className="mono text-xs text-stone-400 mt-3 uppercase tracking-wider">
                {currentMonth || "Loading..."}
              </p>
            </div>
            <div className="flex items-center gap-6">
              {monthlyRevenue > 0 && (
                <div className="text-right hidden sm:block">
                  <p className="mono text-[10px] uppercase tracking-widest text-stone-400">
                    Monthly Revenue
                  </p>
                  <p className="text-3xl font-bold text-amber-300">
                    ${collectedRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    <span className="text-stone-500 font-light">
                      /${monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  </p>
                  <p className="mono text-[10px] uppercase tracking-widest text-rose-300 mt-1">
                    ${outstandingRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} outstanding
                  </p>
                </div>
              )}
              <div className="text-right">
                <p className="mono text-[10px] uppercase tracking-widest text-stone-400">
                  This Month
                </p>
                <p className="text-3xl font-bold">
                  {monthDone}
                  <span className="text-stone-500 font-light">/{monthTotal}</span>
                </p>
              </div>
              <button
                onClick={resetMonth}
                className="mono text-[10px] uppercase tracking-widest border border-stone-700 hover:border-amber-300 hover:text-amber-300 px-3 py-2 transition"
                title="Archive this month and start fresh — keeps your client schedule"
              >
                Close Month →
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Week Tabs */}
      <div className="max-w-5xl mx-auto px-6 pt-8">
        <div className="grid grid-cols-4 gap-2 md:gap-3">
          {[1, 2, 3, 4].map((w) => {
            const wc = clients.filter((c) => c.week === w);
            const wd = wc.filter((c) => c.done).length;
            const isActive = activeWeek === w;
            return (
              <button
                key={w}
                onClick={() => setActiveWeek(w)}
                className={`relative p-4 md:p-5 text-left transition border-2 ${
                  isActive
                    ? "bg-stone-900 text-stone-50 border-stone-900"
                    : "bg-white text-stone-900 border-stone-200 hover:border-stone-900"
                }`}
              >
                <p className="mono text-[10px] uppercase tracking-widest opacity-70">
                  Week
                </p>
                <p className="text-3xl md:text-4xl font-bold leading-none mt-1">
                  0{w}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="mono text-[10px]">
                    {wd}/{wc.length}
                  </span>
                  {wc.length > 0 && wd === wc.length && (
                    <Check
                      className={`w-3 h-3 ${
                        isActive ? "text-amber-300" : "text-emerald-600"
                      }`}
                      strokeWidth={3}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Progress for active week */}
        {totalThisWeek > 0 && (
          <div className="mt-6 bg-white border border-stone-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="mono text-[10px] uppercase tracking-widest text-stone-500">
                Week {activeWeek} Progress
              </p>
              <p className="mono text-xs font-bold">{pct}%</p>
            </div>
            <div className="h-1.5 bg-stone-100 overflow-hidden">
              <div
                className="h-full bg-stone-900 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Weekly Supply Load-Out */}
        {supplyEntries.length > 0 && (
          <div className="mt-4 bg-stone-900 text-stone-50 p-5 stripe-bg">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Droplet
                  className="w-4 h-4 text-amber-300"
                  fill="currentColor"
                />
                <p className="mono text-[10px] uppercase tracking-[0.25em] text-amber-300">
                  Week {activeWeek} Load-Out
                </p>
              </div>
              <p className="mono text-[10px] uppercase tracking-widest text-stone-400">
                Total to bring
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {supplyEntries.map(([scent, data]) => (
                <div key={scent} className="border border-stone-700 p-3">
                  <p className="font-semibold text-sm leading-tight">{scent}</p>
                  <p className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-amber-300">
                      {data.total}
                    </span>
                    <span className="mono text-xs text-stone-400">ml</span>
                  </p>
                  <p className="mono text-[10px] uppercase tracking-widest text-stone-500 mt-1">
                    {data.stops} {data.stops === 1 ? "stop" : "stops"}
                    {data.remaining < data.total && (
                      <span className="text-emerald-400">
                        {" "}
                        · {data.remaining}ml left
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex justify-between items-baseline mb-6">
          <h2 className="text-2xl font-light italic">
            Week {activeWeek}{" "}
            <span className="mono text-xs not-italic text-stone-500 ml-2 uppercase tracking-widest">
              Schedule
            </span>
          </h2>
          <button
            onClick={() => {
              setForm((f) => ({ ...f, week: activeWeek }));
              setShowForm(true);
            }}
            className="bg-stone-900 text-stone-50 px-4 py-2 mono text-xs uppercase tracking-widest hover:bg-amber-300 hover:text-stone-900 transition flex items-center gap-2"
          >
            <Plus className="w-3 h-3" strokeWidth={3} />
            Add Stop
          </button>
        </div>

        {grouped.length === 0 && shipmentClients.length === 0 && (
          <div className="border-2 border-dashed border-stone-200 p-16 text-center bg-white">
            <Calendar
              className="w-10 h-10 mx-auto text-stone-300"
              strokeWidth={1}
            />
            <p className="mt-4 text-stone-500 italic">
              No stops scheduled for week {activeWeek}
            </p>
            <p className="mono text-[10px] uppercase tracking-widest text-stone-400 mt-2">
              Tap &quot;Add Stop&quot; to begin
            </p>
          </div>
        )}

        {/* Shipments */}
        {shipmentClients.length > 0 && (
          <section className="slide-up mb-8">
            <div className="flex items-baseline gap-4 mb-3 pb-2 border-b-2 border-blue-600">
              <h3 className="text-xl font-bold uppercase tracking-tight flex items-center gap-2 text-blue-900">
                <Truck className="w-5 h-5" />
                Shipments
              </h3>
              <span className="mono text-[10px] uppercase tracking-widest text-stone-500">
                {shipmentClients.filter((c) => c.done).length}/
                {shipmentClients.length} sent
              </span>
            </div>
            <div className="space-y-2">
              {shipmentClients
                .sort(
                  (a, b) => days.indexOf(a.day) - days.indexOf(b.day),
                )
                .map((c) => (
                  <article
                    key={c.id}
                    className={`bg-white border transition-all ${
                      c.done
                        ? "border-emerald-200 bg-emerald-50/30"
                        : "border-blue-200 hover:border-blue-600"
                    }`}
                  >
                    <div className="p-4 md:p-5 flex gap-4">
                      <button
                        onClick={() => toggleDone(c.id)}
                        className={`flex-shrink-0 w-7 h-7 border-2 flex items-center justify-center transition ${
                          c.done
                            ? "bg-emerald-600 border-emerald-600 check-pop"
                            : "border-stone-300 hover:border-blue-600"
                        }`}
                        aria-label={c.done ? "Mark not shipped" : "Mark shipped"}
                      >
                        {c.done && (
                          <Check
                            className="w-4 h-4 text-white"
                            strokeWidth={3}
                          />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <h4
                              className={`text-lg font-semibold leading-tight ${
                                c.done
                                  ? "line-through text-stone-400"
                                  : "text-stone-900"
                              }`}
                            >
                              {c.name}
                            </h4>
                            <p className="mono text-xs text-blue-700 mt-0.5 flex items-center gap-1.5">
                              <Truck className="w-3 h-3" />
                              Ship by {c.day}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="mono text-[10px] uppercase tracking-widest bg-blue-50 border border-blue-200 px-2 py-1 text-blue-700 flex items-center gap-1">
                              <Truck className="w-3 h-3" />
                              Shipping
                            </span>
                            {Number(c.subscription_value) > 0 && (
                              <span className="mono text-[10px] uppercase tracking-widest bg-stone-900 text-stone-50 px-2 py-1 flex items-center gap-1">
                                <CreditCard className="w-3 h-3" />
                                ${Number(c.subscription_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => togglePaid(c.id)}
                              className={`mono text-[10px] uppercase tracking-widest border px-2 py-1 flex items-center gap-1 transition ${
                                c.paid
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
                              }`}
                              aria-label={c.paid ? "Mark unpaid" : "Mark paid"}
                            >
                              <DollarSign className="w-3 h-3" />
                              {c.paid ? "Paid" : "Unpaid"}
                            </button>
                          </div>
                        </div>

                        {getScents(c).length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {getScents(c).map((s, idx) => (
                              <div
                                key={idx}
                                className={`inline-flex items-center gap-2 px-3 py-2 border-2 ${
                                  c.done
                                    ? "border-stone-200 bg-white"
                                    : "border-amber-300 bg-amber-50"
                                }`}
                              >
                                <Droplet
                                  className={`w-4 h-4 ${
                                    c.done ? "text-stone-400" : "text-amber-700"
                                  }`}
                                  fill="currentColor"
                                />
                                <div className="flex items-baseline gap-2">
                                  <span
                                    className={`font-semibold text-sm ${
                                      c.done
                                        ? "text-stone-400 line-through"
                                        : "text-stone-900"
                                    }`}
                                  >
                                    {s.scent || "Scent TBD"}
                                  </span>
                                  {s.ml && (
                                    <span className="mono text-xs font-bold text-amber-700">
                                      {s.ml} ml
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 space-y-1.5 text-sm text-stone-600">
                          <p className="flex items-start gap-2">
                            <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-stone-400" />
                            <span>{c.address}</span>
                          </p>
                          {c.contact && (
                            <p className="flex items-center gap-2">
                              <Phone className="w-3.5 h-3.5 flex-shrink-0 text-stone-400" />
                              <a
                                href={`tel:${c.contact}`}
                                className="hover:text-stone-900"
                              >
                                {c.contact}
                              </a>
                            </p>
                          )}
                          {c.notes && (
                            <p className="flex items-start gap-2 italic">
                              <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-stone-400" />
                              <span>{c.notes}</span>
                            </p>
                          )}
                        </div>

                        <div className="mt-3 pt-3 border-t border-stone-100">
                          <label className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-1.5">
                            <Truck className="w-3 h-3" />
                            Tracking Number
                          </label>
                          <input
                            type="text"
                            value={c.tracking || ""}
                            onChange={(e) => updateTracking(c.id, e.target.value)}
                            placeholder="1Z999AA10123456784"
                            className="w-full bg-stone-50 border border-stone-200 px-3 py-2 focus:outline-none focus:border-blue-600 focus:bg-white text-sm mono"
                          />
                        </div>

                        {c.done && c.completed_at && (
                          <p className="mono text-[10px] uppercase tracking-widest text-emerald-700 mt-3">
                            ✓ Shipped {new Date(c.completed_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => deleteClient(c.id)}
                        className="flex-shrink-0 text-stone-300 hover:text-red-500 transition self-start"
                        aria-label="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        )}

        {grouped.length > 0 && shipmentClients.length > 0 && (
          <h3 className="text-xl font-bold uppercase tracking-tight flex items-center gap-2 text-stone-900 mb-3 pb-2 border-b-2 border-stone-900">
            <Wrench className="w-5 h-5" />
            Onsite Visits
          </h3>
        )}

        <div className="space-y-8">
          {grouped.map((group) => (
            <section key={group.day} className="slide-up">
              <div className="flex items-baseline gap-4 mb-3 pb-2 border-b border-stone-900">
                <h3 className="text-xl font-bold uppercase tracking-tight">
                  {group.day}
                </h3>
                <span className="mono text-[10px] uppercase tracking-widest text-stone-500">
                  {group.items.length}{" "}
                  {group.items.length === 1 ? "stop" : "stops"}
                </span>
              </div>
              <div className="space-y-2">
                {group.items.map((c) => (
                  <article
                    key={c.id}
                    className={`bg-white border transition-all ${
                      c.done
                        ? "border-emerald-200 bg-emerald-50/30"
                        : "border-stone-200 hover:border-stone-900"
                    }`}
                  >
                    <div className="p-4 md:p-5 flex gap-4">
                      <button
                        onClick={() => toggleDone(c.id)}
                        className={`flex-shrink-0 w-7 h-7 border-2 flex items-center justify-center transition ${
                          c.done
                            ? "bg-emerald-600 border-emerald-600 check-pop"
                            : "border-stone-300 hover:border-stone-900"
                        }`}
                        aria-label={c.done ? "Mark incomplete" : "Mark complete"}
                      >
                        {c.done && (
                          <Check
                            className="w-4 h-4 text-white"
                            strokeWidth={3}
                          />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <h4
                              className={`text-lg font-semibold leading-tight ${
                                c.done
                                  ? "line-through text-stone-400"
                                  : "text-stone-900"
                              }`}
                            >
                              {c.name}
                            </h4>
                            {c.time && (
                              <p className="mono text-xs text-amber-700 mt-0.5 flex items-center gap-1.5">
                                <Clock className="w-3 h-3" />
                                {c.time}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="mono text-[10px] uppercase tracking-widest bg-stone-100 px-2 py-1 text-stone-600 flex items-center gap-1">
                              <Wrench className="w-3 h-3" />
                              {c.technician}
                            </span>
                            {Number(c.subscription_value) > 0 && (
                              <span className="mono text-[10px] uppercase tracking-widest bg-stone-900 text-stone-50 px-2 py-1 flex items-center gap-1">
                                <CreditCard className="w-3 h-3" />
                                ${Number(c.subscription_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => togglePaid(c.id)}
                              className={`mono text-[10px] uppercase tracking-widest border px-2 py-1 flex items-center gap-1 transition ${
                                c.paid
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
                              }`}
                              aria-label={c.paid ? "Mark unpaid" : "Mark paid"}
                            >
                              <DollarSign className="w-3 h-3" />
                              {c.paid ? "Paid" : "Unpaid"}
                            </button>
                          </div>
                        </div>

                        {getScents(c).length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {getScents(c).map((s, idx) => (
                              <div
                                key={idx}
                                className={`inline-flex items-center gap-2 px-3 py-2 border-2 ${
                                  c.done
                                    ? "border-stone-200 bg-white"
                                    : "border-amber-300 bg-amber-50"
                                }`}
                              >
                                <Droplet
                                  className={`w-4 h-4 ${
                                    c.done ? "text-stone-400" : "text-amber-700"
                                  }`}
                                  fill="currentColor"
                                />
                                <div className="flex items-baseline gap-2">
                                  <span
                                    className={`font-semibold text-sm ${
                                      c.done
                                        ? "text-stone-400 line-through"
                                        : "text-stone-900"
                                    }`}
                                  >
                                    {s.scent || "Scent TBD"}
                                  </span>
                                  {s.ml && (
                                    <span className="mono text-xs font-bold text-amber-700">
                                      {s.ml} ml
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 space-y-1.5 text-sm text-stone-600">
                          <p className="flex items-start gap-2">
                            <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-stone-400" />
                            <span>{c.address}</span>
                          </p>
                          {c.contact && (
                            <p className="flex items-center gap-2">
                              <Phone className="w-3.5 h-3.5 flex-shrink-0 text-stone-400" />
                              <a
                                href={`tel:${c.contact}`}
                                className="hover:text-stone-900"
                              >
                                {c.contact}
                              </a>
                            </p>
                          )}
                          {c.notes && (
                            <p className="flex items-start gap-2 italic">
                              <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-stone-400" />
                              <span>{c.notes}</span>
                            </p>
                          )}
                        </div>

                        {c.done && c.completed_at && (
                          <p className="mono text-[10px] uppercase tracking-widest text-emerald-700 mt-3">
                            ✓ Completed{" "}
                            {new Date(c.completed_at).toLocaleString()}
                          </p>
                        )}

                        {/* Proof of Service */}
                        <div className="mt-3 pt-3 border-t border-stone-100 space-y-3">
                          {/* Photos */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="mono text-[10px] uppercase tracking-widest text-stone-500 flex items-center gap-1.5">
                                <Camera className="w-3 h-3" />
                                Proof Photos
                                {c.photos?.length > 0 && (
                                  <span className="bg-stone-900 text-stone-50 px-1.5 py-0.5 ml-1">
                                    {c.photos.length}
                                  </span>
                                )}
                              </p>
                              <label className="cursor-pointer mono text-[10px] uppercase tracking-widest text-stone-900 hover:text-amber-700 flex items-center gap-1 border border-stone-300 hover:border-amber-700 px-2 py-1 transition">
                                <Plus className="w-3 h-3" strokeWidth={3} />
                                Add Photo
                                <input
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  multiple
                                  className="hidden"
                                  onChange={(e) => {
                                    uploadPhotos(c.id, e.target.files);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>
                            {c.photos?.length > 0 ? (
                              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                                {c.photos.map((photo, idx) => (
                                  <button
                                    key={photo.id}
                                    onClick={() =>
                                      setViewingPhotos({
                                        client: c,
                                        index: idx,
                                      })
                                    }
                                    className="relative aspect-square overflow-hidden border border-stone-200 hover:border-stone-900 transition group"
                                  >
                                    <img
                                      src={photo.url}
                                      alt={`Proof ${idx + 1}`}
                                      className="w-full h-full object-cover"
                                    />
                                    <div className="absolute inset-0 bg-stone-900/0 group-hover:bg-stone-900/30 transition" />
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="mono text-[10px] text-stone-400 italic">
                                No photos yet
                              </p>
                            )}
                          </div>

                          {/* Tech notes */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="mono text-[10px] uppercase tracking-widest text-stone-500 flex items-center gap-1.5">
                                <MessageSquare className="w-3 h-3" />
                                Tech Notes
                              </p>
                              <button
                                onClick={() => openNotesEditor(c)}
                                className="mono text-[10px] uppercase tracking-widest text-stone-900 hover:text-amber-700 flex items-center gap-1 border border-stone-300 hover:border-amber-700 px-2 py-1 transition"
                              >
                                {c.service_notes ? (
                                  "Edit"
                                ) : (
                                  <>
                                    <Plus
                                      className="w-3 h-3"
                                      strokeWidth={3}
                                    />
                                    Add Note
                                  </>
                                )}
                              </button>
                            </div>
                            {c.service_notes ? (
                              <div className="bg-stone-50 border-l-2 border-stone-900 px-3 py-2">
                                <p className="text-sm text-stone-700 whitespace-pre-wrap">
                                  {c.service_notes}
                                </p>
                                {c.notes_updated_at && (
                                  <p className="mono text-[10px] uppercase tracking-widest text-stone-400 mt-1.5">
                                    {new Date(
                                      c.notes_updated_at,
                                    ).toLocaleString()}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="mono text-[10px] text-stone-400 italic">
                                No notes from tech
                              </p>
                            )}
                          </div>

                          {history.some((h) =>
                            h.clients.some((hc) => hc.id === c.id),
                          ) && (
                            <button
                              onClick={() => setShowHistory(c)}
                              className="mono text-[10px] uppercase tracking-widest text-stone-500 hover:text-stone-900 flex items-center gap-1 transition"
                            >
                              <History className="w-3 h-3" />
                              View past months
                            </button>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteClient(c.id)}
                        className="flex-shrink-0 text-stone-300 hover:text-red-500 transition self-start"
                        aria-label="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      {/* Add Form Modal */}
      {showForm && (
        <div
          className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-6"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-stone-50 w-full max-w-lg max-h-[90vh] overflow-y-auto slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-stone-900 text-stone-50 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="mono text-[10px] uppercase tracking-widest text-amber-300">
                  New Stop
                </p>
                <h3 className="text-xl font-light italic">Add Client Visit</h3>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="hover:text-amber-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-2">
                  Service Type
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, serviceType: "physical" })
                    }
                    className={`p-3 border-2 transition flex items-center gap-2 ${
                      form.serviceType === "physical"
                        ? "border-stone-900 bg-stone-900 text-stone-50"
                        : "border-stone-200 bg-white text-stone-600 hover:border-stone-900"
                    }`}
                  >
                    <Wrench className="w-4 h-4 flex-shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-semibold">Physical Refill</p>
                      <p className="mono text-[10px] uppercase tracking-widest opacity-70">
                        Tech visits onsite
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, serviceType: "shipping" })
                    }
                    className={`p-3 border-2 transition flex items-center gap-2 ${
                      form.serviceType === "shipping"
                        ? "border-stone-900 bg-stone-900 text-stone-50"
                        : "border-stone-200 bg-white text-stone-600 hover:border-stone-900"
                    }`}
                  >
                    <Truck className="w-4 h-4 flex-shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-semibold">Shipping</p>
                      <p className="mono text-[10px] uppercase tracking-widest opacity-70">
                        Mail to client
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <Field label="Client Name" icon={User}>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Acme Corp"
                  className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900"
                />
              </Field>
              <Field
                label={
                  form.serviceType === "shipping"
                    ? "Shipping Address"
                    : "Address"
                }
                icon={MapPin}
              >
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                  placeholder="123 Main St, Suite 200"
                  className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900"
                />
              </Field>

              {/* Scents */}
              <div className="bg-amber-50 border-2 border-amber-300 p-3 -mx-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="mono text-[10px] uppercase tracking-widest text-amber-800 flex items-center gap-1.5">
                    <Droplet className="w-3 h-3" fill="currentColor" />
                    Supply for this stop
                  </p>
                  <button
                    type="button"
                    onClick={addScentRow}
                    className="mono text-[10px] uppercase tracking-widest text-amber-800 hover:text-stone-900 flex items-center gap-1 border border-amber-700 hover:border-stone-900 px-2 py-1 transition"
                  >
                    <Plus className="w-3 h-3" strokeWidth={3} />
                    Add Scent
                  </button>
                </div>
                <div className="space-y-2">
                  {form.scents.map((s, idx) => (
                    <div key={idx} className="flex gap-2 items-stretch">
                      <input
                        type="text"
                        value={s.scent}
                        onChange={(e) =>
                          updateScentRow(idx, "scent", e.target.value)
                        }
                        placeholder={`Scent ${idx + 1} (e.g. Cedarwood)`}
                        className="flex-1 bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-amber-700 text-sm min-w-0"
                      />
                      <div className="relative w-24 flex-shrink-0">
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={s.ml}
                          onChange={(e) =>
                            updateScentRow(idx, "ml", e.target.value)
                          }
                          placeholder="500"
                          className="w-full bg-white border border-stone-300 px-3 py-2.5 pr-8 focus:outline-none focus:border-amber-700 text-sm"
                        />
                        <span className="mono text-[10px] absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none">
                          ml
                        </span>
                      </div>
                      {(form.scents.length > 1 || s.scent || s.ml) && (
                        <button
                          type="button"
                          onClick={() => removeScentRow(idx)}
                          className="flex-shrink-0 px-2 text-stone-400 hover:text-red-500 transition"
                          aria-label="Remove scent"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Week" icon={Calendar}>
                  <select
                    value={form.week}
                    onChange={(e) =>
                      setForm({ ...form, week: parseInt(e.target.value) })
                    }
                    className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900"
                  >
                    {[1, 2, 3, 4].map((w) => (
                      <option key={w} value={w}>
                        Week {w}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.serviceType === "physical" ? (
                  <Field label="Day">
                    <select
                      value={form.day}
                      onChange={(e) =>
                        setForm({ ...form, day: e.target.value })
                      }
                      className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900"
                    >
                      {days.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="Ship by">
                    <select
                      value={form.day}
                      onChange={(e) =>
                        setForm({ ...form, day: e.target.value })
                      }
                      className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900"
                    >
                      {days.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>

              {form.serviceType === "physical" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Time" icon={Clock}>
                    <input
                      type="time"
                      value={form.time}
                      onChange={(e) =>
                        setForm({ ...form, time: e.target.value })
                      }
                      className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900"
                    />
                  </Field>
                  <Field label="Technician">
                    <select
                      value={form.technician}
                      onChange={(e) =>
                        setForm({ ...form, technician: e.target.value })
                      }
                      className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900"
                    >
                      <option value="Tech 1">Tech 1</option>
                      <option value="Tech 2">Tech 2</option>
                      <option value="Both">Both</option>
                    </select>
                  </Field>
                </div>
              )}

              <Field label="Contact Phone" icon={Phone}>
                <input
                  type="tel"
                  value={form.contact}
                  onChange={(e) =>
                    setForm({ ...form, contact: e.target.value })
                  }
                  placeholder="(555) 123-4567"
                  className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900"
                />
              </Field>
              <Field label="Subscription Value (per month)" icon={DollarSign}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={form.subscriptionValue}
                    onChange={(e) =>
                      setForm({ ...form, subscriptionValue: e.target.value })
                    }
                    placeholder="150.00"
                    className="w-full bg-white border border-stone-300 pl-7 pr-3 py-2.5 focus:outline-none focus:border-stone-900"
                  />
                </div>
              </Field>
              <Field label="Notes" icon={FileText}>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Gate code, scent preference, access instructions..."
                  rows={3}
                  className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900 resize-none"
                />
              </Field>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 border border-stone-300 px-4 py-3 mono text-xs uppercase tracking-widest hover:border-stone-900 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={addClient}
                  disabled={!form.name.trim() || !form.address.trim()}
                  className="flex-1 bg-stone-900 text-stone-50 px-4 py-3 mono text-xs uppercase tracking-widest hover:bg-amber-300 hover:text-stone-900 transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Save Stop
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tech Notes Editor */}
      {editingNotesFor && (
        <div
          className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-6"
          onClick={() => {
            setEditingNotesFor(null);
            setNotesDraft("");
          }}
        >
          <div
            className="bg-stone-50 w-full max-w-lg max-h-[90vh] overflow-y-auto slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-stone-900 text-stone-50 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="mono text-[10px] uppercase tracking-widest text-amber-300">
                  Tech Notes
                </p>
                <h3 className="text-xl font-light italic">
                  {clients.find((c) => c.id === editingNotesFor)?.name}
                </h3>
              </div>
              <button
                onClick={() => {
                  setEditingNotesFor(null);
                  setNotesDraft("");
                }}
                className="hover:text-amber-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-stone-600">
                Note anything you noticed at this stop — diffuser issues, low
                refill, customer feedback, access problems, etc.
              </p>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="e.g. Front diffuser nozzle clogged - cleaned but may need replacement next month."
                rows={6}
                autoFocus
                className="w-full bg-white border border-stone-300 px-3 py-2.5 focus:outline-none focus:border-stone-900 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditingNotesFor(null);
                    setNotesDraft("");
                  }}
                  className="flex-1 border border-stone-300 px-4 py-3 mono text-xs uppercase tracking-widest hover:border-stone-900 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={saveServiceNotes}
                  className="flex-1 bg-stone-900 text-stone-50 px-4 py-3 mono text-xs uppercase tracking-widest hover:bg-amber-300 hover:text-stone-900 transition"
                >
                  Save Notes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Viewer */}
      {showHistory && (
        <div
          className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-0 md:p-6"
          onClick={() => setShowHistory(null)}
        >
          <div
            className="bg-stone-50 w-full max-w-2xl max-h-[90vh] overflow-y-auto slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-stone-900 text-stone-50 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
              <div>
                <p className="mono text-[10px] uppercase tracking-widest text-amber-300 flex items-center gap-1.5">
                  <History className="w-3 h-3" />
                  Service History
                </p>
                <h3 className="text-xl font-light italic">
                  {showHistory.name}
                </h3>
              </div>
              <button
                onClick={() => setShowHistory(null)}
                className="hover:text-amber-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {history
                .filter((h) =>
                  h.clients.some((hc) => hc.id === showHistory.id),
                )
                .map((archive) => {
                  const past = archive.clients.find(
                    (hc) => hc.id === showHistory.id,
                  );
                  if (!past) return null;
                  return (
                    <div
                      key={archive.id}
                      className="border border-stone-200 bg-white p-4"
                    >
                      <div className="flex items-center justify-between mb-3 pb-2 border-b border-stone-100">
                        <p className="font-semibold">{archive.month}</p>
                        <span
                          className={`mono text-[10px] uppercase tracking-widest px-2 py-1 ${
                            past.done
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {past.done ? "✓ Completed" : "Not completed"}
                        </span>
                      </div>
                      {past.completed_at && (
                        <p className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-2">
                          Done {new Date(past.completed_at).toLocaleString()}
                        </p>
                      )}
                      {past.service_notes && (
                        <div className="bg-stone-50 border-l-2 border-stone-900 px-3 py-2 mb-3">
                          <p className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1">
                            Tech Notes
                          </p>
                          <p className="text-sm text-stone-700 whitespace-pre-wrap">
                            {past.service_notes}
                          </p>
                        </div>
                      )}
                      {past.photos?.length > 0 && (
                        <div>
                          <p className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-2">
                            Photos ({past.photos.length})
                          </p>
                          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                            {past.photos.map((photo, pidx) => (
                              <button
                                key={photo.id}
                                onClick={() =>
                                  setViewingPhotos({
                                    client: {
                                      ...past,
                                      name: `${past.name} · ${archive.month}`,
                                    },
                                    index: pidx,
                                  })
                                }
                                className="relative aspect-square overflow-hidden border border-stone-200 hover:border-stone-900 transition"
                              >
                                <img
                                  src={photo.url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {!past.service_notes &&
                        (!past.photos || past.photos.length === 0) && (
                          <p className="mono text-[10px] text-stone-400 italic">
                            No notes or photos recorded
                          </p>
                        )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox */}
      {viewingPhotos &&
        viewingPhotos.client.photos?.[viewingPhotos.index] && (
          <div
            className="fixed inset-0 bg-black/95 z-50 flex flex-col"
            onClick={() => setViewingPhotos(null)}
          >
            <div
              className="flex items-center justify-between p-4 text-stone-50"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <p className="mono text-[10px] uppercase tracking-widest text-amber-300">
                  {viewingPhotos.client.name}
                </p>
                <p className="mono text-xs text-stone-400">
                  Photo {viewingPhotos.index + 1} of{" "}
                  {viewingPhotos.client.photos.length}
                  {" · "}
                  {new Date(
                    viewingPhotos.client.photos[viewingPhotos.index].uploaded_at,
                  ).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (confirm("Delete this photo?")) {
                      removePhoto(
                        viewingPhotos.client.id,
                        viewingPhotos.client.photos[viewingPhotos.index].id,
                      );
                    }
                  }}
                  className="text-stone-400 hover:text-red-400 p-2 transition"
                  aria-label="Delete photo"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setViewingPhotos(null)}
                  className="text-stone-50 hover:text-amber-300 p-2 transition"
                  aria-label="Close"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div
              className="flex-1 flex items-center justify-center p-4 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={viewingPhotos.client.photos[viewingPhotos.index].url}
                alt="Proof of service"
                className="max-w-full max-h-full object-contain"
              />
            </div>
            {viewingPhotos.client.photos.length > 1 && (
              <div
                className="p-4 flex items-center justify-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() =>
                    setViewingPhotos({
                      ...viewingPhotos,
                      index:
                        (viewingPhotos.index -
                          1 +
                          viewingPhotos.client.photos.length) %
                        viewingPhotos.client.photos.length,
                    })
                  }
                  className="mono text-xs uppercase tracking-widest border border-stone-700 hover:border-amber-300 hover:text-amber-300 text-stone-50 px-4 py-2 transition"
                >
                  ← Prev
                </button>
                <button
                  onClick={() =>
                    setViewingPhotos({
                      ...viewingPhotos,
                      index:
                        (viewingPhotos.index + 1) %
                        viewingPhotos.client.photos.length,
                    })
                  }
                  className="mono text-xs uppercase tracking-widest border border-stone-700 hover:border-amber-300 hover:text-amber-300 text-stone-50 px-4 py-2 transition"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

      <footer className="max-w-5xl mx-auto px-6 py-12 text-center">
        <p className="mono text-[10px] uppercase tracking-[0.3em] text-stone-400">
          Synced live across devices · Tap a circle to check off
        </p>
      </footer>
    </div>
  );
}

// ----------------------------- Field helper -----------------------------

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mono text-[10px] uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </label>
      {children}
    </div>
  );
}
