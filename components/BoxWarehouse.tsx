"use client";

// Almacén de Cajas — what is inside every box, in which warehouse, and every
// movement in and out. Boxes point at a fixed product list, so the per-product
// totals never split because a name was typed two different ways.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  Camera,
  ImageOff,
  MinusCircle,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ types */

export type Warehouse = {
  id: string;
  name: string;
  is_main: boolean;
  sort: number;
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  active: boolean;
};

export type BoxItem = { id: string; product_id: string; qty: number };

export type Box = {
  id: string;
  code: string;
  warehouse_id: string | null;
  location: string;
  arrived_on: string;
  moved_on: string | null;
  notes: string;
  photo_url: string;
  photo_path: string;
  box_items: BoxItem[] | null;
};

export type Movement = {
  id: string;
  box_code: string;
  product_name: string;
  kind: "in" | "out" | "transfer" | "adjust";
  qty: number;
  from_warehouse_id: string | null;
  to_warehouse_id: string | null;
  note: string;
  moved_by: string;
  created_at: string;
};

type DraftLine = { product_id: string; qty: string };

type BoxDraft = {
  id: string | null;
  code: string;
  warehouse_id: string;
  location: string;
  arrived_on: string;
  notes: string;
  photo_url: string;
  photo_path: string;
  lines: DraftLine[];
};

const BUCKET = "box-photos";
const MAX_SIDE = 1200;

/* ------------------------------------------------------------- utilities */

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

const num = (n: number) =>
  Number(n).toLocaleString("es-PA", { maximumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

const prettyDate = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  const months = ["ene", "feb", "mar", "abr", "may", "jun",
                  "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(d)} ${months[Number(m) - 1] ?? ""} ${y}`;
};

/** Downscale + re-encode in the browser so uploads stay small. */
function compress(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("No es una imagen"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagen no válida"));
      img.onload = () => {
        const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas no disponible"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("No se pudo comprimir"))),
          "image/jpeg",
          0.75,
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------- component */

export function BoxWarehouse({
  initialWarehouses,
  initialProducts,
  initialBoxes,
  initialMovements,
  currentUser,
}: {
  initialWarehouses: Warehouse[];
  initialProducts: Product[];
  initialBoxes: Box[];
  initialMovements: Movement[];
  currentUser: string;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [boxes, setBoxes] = useState<Box[]>(initialBoxes);
  const [movements, setMovements] = useState<Movement[]>(initialMovements);

  const [whId, setWhId] = useState<string>(
    initialWarehouses.find((w) => !w.is_main)?.id ?? initialWarehouses[0]?.id ?? "",
  );
  const [tab, setTab] = useState<"boxes" | "byProduct" | "moves">("boxes");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<BoxDraft | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<Blob | null>(null);
  const [pendingPreview, setPendingPreview] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);

  const [takeFrom, setTakeFrom] = useState<{ box: Box; productId: string } | null>(null);
  const [takeQty, setTakeQty] = useState("");
  const [takeNote, setTakeNote] = useState("");

  const productById = useMemo(() => {
    const m: Record<string, Product> = {};
    for (const p of products) m[p.id] = p;
    return m;
  }, [products]);

  const whById = useMemo(() => {
    const m: Record<string, Warehouse> = {};
    for (const w of warehouses) m[w.id] = w;
    return m;
  }, [warehouses]);

  const mainWh = warehouses.find((w) => w.is_main) ?? null;
  const currentWh = whById[whId] ?? null;

  /* ------------------------------------------------------------- refresh */

  const refresh = useCallback(async () => {
    const [{ data: w }, { data: p }, { data: b }, { data: m }] = await Promise.all([
      supabase.from("warehouses").select("*").order("sort", { ascending: true }),
      supabase.from("products").select("*").order("name", { ascending: true }),
      supabase.from("boxes").select("*, box_items(id, product_id, qty)")
        .order("code", { ascending: true }),
      supabase.from("box_movements").select("*")
        .order("created_at", { ascending: false }).limit(100),
    ]);
    if (w) setWarehouses(w as Warehouse[]);
    if (p) setProducts(p as Product[]);
    if (b) setBoxes(b as Box[]);
    if (m) setMovements(m as Movement[]);
  }, [supabase]);

  useEffect(() => {
    const ch = supabase
      .channel("cajas_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "boxes" },
        () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "box_items" },
        () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "box_movements" },
        () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, refresh]);

  /* ------------------------------------------------------------- derived */

  const unitsOf = useCallback(
    (b: Box) => (b.box_items ?? []).reduce((s, i) => s + Number(i.qty), 0),
    [],
  );

  const matches = useCallback(
    (b: Box) => {
      const q = norm(query);
      if (!q) return true;
      if (norm(b.code).includes(q) || norm(b.location).includes(q)) return true;
      return (b.box_items ?? []).some((i) =>
        norm(productById[i.product_id]?.name).includes(q),
      );
    },
    [query, productById],
  );

  const boxesHere = useMemo(
    () => boxes.filter((b) => b.warehouse_id === whId && matches(b)),
    [boxes, whId, matches],
  );

  const stats = useMemo(() => {
    const here = boxes.filter((b) => b.warehouse_id === whId);
    return {
      boxes: here.length,
      units: here.reduce((s, b) => s + unitsOf(b), 0),
      inMain: mainWh ? boxes.filter((b) => b.warehouse_id === mainWh.id).length : 0,
    };
  }, [boxes, whId, mainWh, unitsOf]);

  /** Per-product totals across the boxes in the selected warehouse. */
  const byProduct = useMemo(() => {
    const acc: Record<string, { qty: number; codes: string[] }> = {};
    for (const b of boxes) {
      if (b.warehouse_id !== whId) continue;
      for (const i of b.box_items ?? []) {
        acc[i.product_id] ??= { qty: 0, codes: [] };
        acc[i.product_id].qty += Number(i.qty);
        if (!acc[i.product_id].codes.includes(b.code)) acc[i.product_id].codes.push(b.code);
      }
    }
    return Object.entries(acc)
      .map(([id, v]) => ({ product: productById[id], ...v }))
      .filter((r) => r.product)
      .filter((r) => !query || norm(r.product.name).includes(norm(query)))
      .sort((a, b) => b.qty - a.qty);
  }, [boxes, whId, productById, query]);

  /* ---------------------------------------------------------- box editor */

  const emptyDraft = (): BoxDraft => ({
    id: null, code: "", warehouse_id: whId, location: "",
    arrived_on: today(), notes: "", photo_url: "", photo_path: "",
    lines: [{ product_id: "", qty: "" }],
  });

  async function openNew() {
    setNotice("");
    const { data } = await supabase.rpc("next_box_code");
    setDraft({ ...emptyDraft(), code: (data as string) ?? "" });
    setPendingPhoto(null);
    setPendingPreview("");
  }

  function openEdit(b: Box) {
    setNotice("");
    setDraft({
      id: b.id,
      code: b.code,
      warehouse_id: b.warehouse_id ?? whId,
      location: b.location,
      arrived_on: b.arrived_on.slice(0, 10),
      notes: b.notes,
      photo_url: b.photo_url,
      photo_path: b.photo_path,
      lines: (b.box_items ?? []).length
        ? (b.box_items ?? []).map((i) => ({ product_id: i.product_id, qty: String(i.qty) }))
        : [{ product_id: "", qty: "" }],
    });
    setPendingPhoto(null);
    setPendingPreview("");
  }

  function closeDraft() {
    setDraft(null);
    setPendingPhoto(null);
    setPendingPreview("");
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await compress(file);
      setPendingPhoto(blob);
      setPendingPreview(URL.createObjectURL(blob));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo cargar la foto");
    }
  }

  /** Creates a product on the spot so nobody has to leave the box form. */
  async function addProduct() {
    const name = window.prompt("Nombre del producto nuevo");
    if (!name || !name.trim()) return;
    const { data, error } = await supabase
      .from("products").insert({ name: name.trim() }).select().single();
    if (error) { setNotice(error.message); return; }
    setProducts((p) => [...p, data as Product].sort((a, b) => a.name.localeCompare(b.name, "es")));
    return (data as Product).id;
  }

  async function saveDraft() {
    if (!draft) return;
    const lines = draft.lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) => ({ product_id: l.product_id, qty: Number(l.qty) }));

    const seen = new Set<string>();
    for (const l of lines) {
      if (seen.has(l.product_id)) {
        setNotice("Hay un producto repetido en la caja. Junta las dos líneas en una.");
        return;
      }
      seen.add(l.product_id);
    }
    if (!draft.code.trim()) { setNotice("La caja necesita un código."); return; }

    setBusy(true);
    setNotice("");
    try {
      let photo_url = draft.photo_url;
      let photo_path = draft.photo_path;
      if (pendingPhoto) {
        const path = `${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET).upload(path, pendingPhoto, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        photo_path = path;
        photo_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const row = {
        code: draft.code.trim(),
        warehouse_id: draft.warehouse_id || null,
        location: draft.location.trim(),
        arrived_on: draft.arrived_on,
        notes: draft.notes.trim(),
        photo_url,
        photo_path,
        created_by: currentUser,
      };

      let boxId = draft.id;
      if (boxId) {
        const { error } = await supabase.from("boxes").update(row).eq("id", boxId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("boxes").insert(row).select().single();
        if (error) throw error;
        boxId = (data as Box).id;
      }

      // Replace the contents wholesale: simplest thing that is always correct.
      await supabase.from("box_items").delete().eq("box_id", boxId);
      if (lines.length) {
        const { error } = await supabase.from("box_items")
          .insert(lines.map((l) => ({ box_id: boxId, ...l })));
        if (error) throw error;
      }

      await refresh();
      closeDraft();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function removeBox(b: Box) {
    if (!window.confirm(`¿Borrar la caja ${b.code} y todo su contenido?`)) return;
    if (b.photo_path) await supabase.storage.from(BUCKET).remove([b.photo_path]);
    await supabase.from("boxes").delete().eq("id", b.id);
    await refresh();
  }

  /* ------------------------------------------------------------ movement */

  async function moveBox(b: Box, toId: string) {
    setBusy(true);
    const { error } = await supabase.rpc("move_box", {
      p_box_id: b.id, p_to_warehouse: toId, p_by: currentUser,
    });
    if (error) setNotice(error.message);
    await refresh();
    setBusy(false);
  }

  async function doTake() {
    if (!takeFrom) return;
    const qty = Number(takeQty.replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) { setNotice("Pon una cantidad válida."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("take_units", {
      p_box_id: takeFrom.box.id,
      p_product_id: takeFrom.productId,
      p_qty: qty,
      p_note: takeNote,
      p_by: currentUser,
    });
    if (error) setNotice(error.message);
    else { setTakeFrom(null); setTakeQty(""); setTakeNote(""); }
    await refresh();
    setBusy(false);
  }

  /* -------------------------------------------------------------- render */

  const field =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900";
  const label = "mb-1 block text-xs font-semibold text-neutral-500";
  const card = "rounded-xl border border-neutral-200 bg-white";

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-6">
      {/* header */}
      <div className="mb-4 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900">
          <ArrowLeft size={16} /> Inicio
        </Link>
        <select
          value={whId}
          onChange={(e) => setWhId(e.target.value)}
          className="ml-auto rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm"
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
        FRAGRANZA 613 · {currentWh?.name ?? "—"}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Almacén de Cajas</h1>

      {/* stats */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          { n: stats.boxes, l: "cajas aquí" },
          { n: stats.units, l: "unidades aquí" },
          { n: stats.inMain, l: "cajas en principal" },
        ].map((s) => (
          <div key={s.l} className={`${card} p-3`}>
            <div className="text-2xl font-semibold">{num(s.n)}</div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">{s.l}</div>
          </div>
        ))}
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice("")} className="text-amber-700"><X size={15} /></button>
        </div>
      )}

      {/* tabs + search */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <div className="flex overflow-hidden rounded-xl border border-neutral-300">
          {([["boxes", "En bodega"], ["byProduct", "Por producto"], ["moves", "Movimientos"]] as const)
            .map(([k, t]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3 py-2 text-sm font-semibold ${
                  tab === k ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-100"
                }`}
              >
                {t}
              </button>
            ))}
        </div>
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar caja, producto o ubicación…"
            className={`${field} pl-9`}
          />
        </div>
      </div>

      {/* ------------------------------------------------------ boxes tab */}
      {tab === "boxes" && (
        <div className="mt-4 space-y-3">
          {boxesHere.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
              {query ? `Nada coincide con “${query}”.` : "No hay cajas en esta bodega todavía."}
            </div>
          )}

          {boxesHere.map((b) => (
            <section key={b.id} className={`${card} overflow-hidden`}>
              <div className="flex">
                {/* code block */}
                <div className="flex w-24 shrink-0 flex-col items-center justify-center bg-[#b08b57] p-3 text-white">
                  {b.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.photo_url} alt="" loading="lazy"
                      className="mb-2 h-14 w-14 rounded object-cover" />
                  ) : (
                    <ImageOff size={16} className="mb-2 opacity-50" />
                  )}
                  <div className="font-mono text-lg font-bold leading-none">{b.code}</div>
                  <div className="mt-1 font-mono text-[11px] opacity-80">{num(unitsOf(b))} u.</div>
                </div>

                <div className="min-w-0 flex-1 p-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-neutral-600">
                      {whById[b.warehouse_id ?? ""]?.name ?? "sin bodega"}
                    </span>
                    {b.location && (
                      <span className="text-neutral-500">Ubicación <b className="text-neutral-800">{b.location}</b></span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    Llegó <b className="text-neutral-800">{prettyDate(b.arrived_on)}</b>
                    {b.moved_on && <> · Movida <b className="text-neutral-800">{prettyDate(b.moved_on)}</b></>}
                  </p>

                  <ul className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100">
                    {(b.box_items ?? []).length === 0 && (
                      <li className="py-2 text-sm italic text-neutral-400">Sin contenido anotado</li>
                    )}
                    {(b.box_items ?? []).map((i) => (
                      <li key={i.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          {productById[i.product_id]?.name ?? "—"}
                        </span>
                        <span className="font-semibold tabular-nums">{num(Number(i.qty))}</span>
                        <button
                          title="Sacar unidades"
                          onClick={() => { setTakeFrom({ box: b, productId: i.product_id }); setTakeQty(""); setTakeNote(""); }}
                          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
                        >
                          <MinusCircle size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>

                  {b.notes && <p className="mt-2 text-xs italic text-neutral-500">{b.notes}</p>}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {warehouses.filter((w) => w.id !== b.warehouse_id).map((w) => (
                      <button
                        key={w.id}
                        disabled={busy}
                        onClick={() => void moveBox(b, w.id)}
                        className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <ArrowRightLeft size={12} /> Pasar a {w.name}
                      </button>
                    ))}
                    <button onClick={() => openEdit(b)}
                      className="flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs hover:bg-neutral-50">
                      <Pencil size={12} /> Editar
                    </button>
                    <button onClick={() => void removeBox(b)}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-neutral-500 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={12} /> Borrar
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* -------------------------------------------------- byProduct tab */}
      {tab === "byProduct" && (
        <div className="mt-4 space-y-2">
          {byProduct.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
              Nada que contar en esta bodega.
            </div>
          )}
          {byProduct.map((r) => (
            <div key={r.product.id} className={`${card} flex items-center gap-3 p-3`}>
              <Package size={16} className="shrink-0 text-neutral-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.product.name}</p>
                <p className="truncate font-mono text-xs text-neutral-500">{r.codes.join(" · ")}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-semibold tabular-nums">{num(r.qty)}</div>
                <div className="text-[11px] text-neutral-500">
                  {r.codes.length} {r.codes.length === 1 ? "caja" : "cajas"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------ moves tab */}
      {tab === "moves" && (
        <div className={`${card} mt-4 divide-y divide-neutral-100`}>
          {movements.length === 0 && (
            <p className="p-10 text-center text-sm text-neutral-500">Todavía no hay movimientos.</p>
          )}
          {movements.map((m) => (
            <div key={m.id} className="flex items-start gap-3 p-3 text-sm">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
                m.kind === "out" ? "bg-red-50 text-red-700"
                : m.kind === "transfer" ? "bg-emerald-50 text-emerald-700"
                : "bg-neutral-100 text-neutral-600"
              }`}>
                {m.kind === "out" ? "salida" : m.kind === "transfer" ? "traslado" : m.kind}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <b className="font-mono">{m.box_code}</b>
                  {m.product_name && <> · {m.product_name}</>}
                  {Number(m.qty) > 0 && <> · <b>{num(Number(m.qty))}</b> u.</>}
                </p>
                <p className="truncate text-xs text-neutral-500">
                  {m.kind === "transfer" && (
                    <>{whById[m.from_warehouse_id ?? ""]?.name ?? "—"} → {whById[m.to_warehouse_id ?? ""]?.name ?? "—"} · </>
                  )}
                  {new Date(m.created_at).toLocaleString("es-PA")}
                  {m.moved_by && <> · {m.moved_by}</>}
                  {m.note && <> · {m.note}</>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* new box */}
      <button
        onClick={() => void openNew()}
        className="fixed bottom-6 right-6 z-20 flex items-center gap-2 rounded-full bg-neutral-900 px-5 py-3.5 text-sm font-semibold text-white shadow-lg hover:bg-neutral-700"
      >
        <Plus size={18} /> Nueva caja
      </button>

      {/* ------------------------------------------------------ box editor */}
      {draft && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-black/45 p-4 sm:p-8"
          onClick={(e) => e.target === e.currentTarget && closeDraft()}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Boxes size={18} /> {draft.id ? `Editar ${draft.code}` : "Nueva caja"}
            </h3>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Código</label>
                <input className={`${field} font-mono`} value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
              </div>
              <div>
                <label className={label}>Bodega</label>
                <select className={field} value={draft.warehouse_id}
                  onChange={(e) => setDraft({ ...draft, warehouse_id: e.target.value })}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Ubicación</label>
                <input className={field} value={draft.location} placeholder="Pasillo A · Estante 2"
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
              </div>
              <div>
                <label className={label}>Llegó</label>
                <input className={field} type="date" value={draft.arrived_on}
                  onChange={(e) => setDraft({ ...draft, arrived_on: e.target.value })} />
              </div>
            </div>

            <label className={`${label} mt-4`}>Contenido</label>
            <div className="space-y-2">
              {draft.lines.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <select
                    className={`${field} flex-1`}
                    value={l.product_id}
                    onChange={async (e) => {
                      const v = e.target.value;
                      const next = [...draft.lines];
                      if (v === "__new__") {
                        const id = await addProduct();
                        next[i] = { ...next[i], product_id: id ?? "" };
                      } else {
                        next[i] = { ...next[i], product_id: v };
                      }
                      setDraft({ ...draft, lines: next });
                    }}
                  >
                    <option value="">Elegir producto…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="__new__">+ Producto nuevo…</option>
                  </select>
                  <input
                    className={`${field} w-24`}
                    type="number"
                    min="0"
                    value={l.qty}
                    placeholder="Cant."
                    onChange={(e) => {
                      const next = [...draft.lines];
                      next[i] = { ...next[i], qty: e.target.value };
                      setDraft({ ...draft, lines: next });
                    }}
                  />
                  <button
                    onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}
                    className="rounded-lg px-2 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setDraft({ ...draft, lines: [...draft.lines, { product_id: "", qty: "" }] })}
              className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            >
              + Añadir producto a la caja
            </button>

            <label className={`${label} mt-4`}>Notas</label>
            <input className={field} value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />

            <label className={`${label} mt-4`}>Foto de la caja</label>
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3">
              {pendingPreview || draft.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pendingPreview || draft.photo_url} alt=""
                  className="h-16 w-16 rounded-lg border border-neutral-200 object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-300">
                  <Camera size={20} />
                </div>
              )}
              <div className="flex-1 text-xs text-neutral-500">
                Se reescala sola antes de subirla.
              </div>
              <input ref={photoRef} type="file" accept="image/*" hidden
                onChange={(e) => void onPickPhoto(e.target.files?.[0])} />
              <button type="button" onClick={() => photoRef.current?.click()}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100">
                Elegir…
              </button>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={closeDraft}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-50">
                Cancelar
              </button>
              <button onClick={() => void saveDraft()} disabled={busy}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50">
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- take units */}
      {takeFrom && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-black/45 p-4 sm:p-8"
          onClick={(e) => e.target === e.currentTarget && setTakeFrom(null)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6">
            <h3 className="text-lg font-semibold">Sacar unidades</h3>
            <p className="mt-1 text-sm text-neutral-500">
              <b className="font-mono">{takeFrom.box.code}</b> ·{" "}
              {productById[takeFrom.productId]?.name ?? "—"} · quedan{" "}
              <b>
                {num(Number(
                  (takeFrom.box.box_items ?? []).find((i) => i.product_id === takeFrom.productId)?.qty ?? 0,
                ))}
              </b>
            </p>

            <label className={`${label} mt-4`}>Cantidad a sacar</label>
            <input className={field} type="number" min="0" autoFocus
              value={takeQty} onChange={(e) => setTakeQty(e.target.value)} />

            <label className={`${label} mt-3`}>Nota (opcional)</label>
            <input className={field} value={takeNote} placeholder="A quién o para qué"
              onChange={(e) => setTakeNote(e.target.value)} />

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setTakeFrom(null)}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-50">
                Cancelar
              </button>
              <button onClick={() => void doTake()} disabled={busy}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50">
                {busy ? "Sacando…" : "Sacar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
