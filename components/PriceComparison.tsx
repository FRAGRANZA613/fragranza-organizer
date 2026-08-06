"use client";

// Competitor price comparison. One row per price observation, append-only:
// a new check is a new row, so older rows become the price history.
// Search by item, competitor or model; every teammate sees the same data live.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Download,
  ImageOff,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ types */

export type PriceEntry = {
  id: string;
  item: string;
  country: string;
  our_price: number;
  competitor: string;
  competitor_model: string;
  competitor_price: number;
  photo_url: string;
  photo_path: string;
  checked_on: string; // yyyy-mm-dd
  recorded_by: string;
  created_at: string;
  updated_at: string;
};

type FormState = {
  id: string | null;
  item: string;
  country: string;
  our_price: string;
  competitor: string;
  competitor_model: string;
  competitor_price: string;
  checked_on: string;
  recorded_by: string;
  photo_url: string;
  photo_path: string;
};

const BUCKET = "price-photos";
const MAX_SIDE = 1200;

/* -------------------------------------------------------------- utilities */

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const money = (n: number) =>
  Number(n).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const today = () => new Date().toISOString().slice(0, 10);

const compKey = (e: PriceEntry) =>
  e.competitor + (e.competitor_model ? " ▸ " + e.competitor_model : "");

const emptyForm = (user: string): FormState => ({
  id: null,
  item: "",
  country: "",
  our_price: "",
  competitor: "",
  competitor_model: "",
  competitor_price: "",
  checked_on: today(),
  recorded_by: user,
  photo_url: "",
  photo_path: "",
});

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
          (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo comprimir"))),
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

export function PriceComparison({
  initialEntries,
  currentUser,
}: {
  initialEntries: PriceEntry[];
  currentUser: string;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [entries, setEntries] = useState<PriceEntry[]>(initialEntries);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<Blob | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<PriceEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ---------------------------------------------------------- data sync */

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("price_entries")
      .select("*")
      .order("checked_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (data) setEntries(data as PriceEntry[]);
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("price_entries_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "price_entries" },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  /* ------------------------------------------------------------ derived */

  const uniq = useCallback(
    (field: keyof PriceEntry) =>
      Array.from(
        new Set(entries.map((e) => String(e[field] ?? "")).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b, "es")),
    [entries],
  );

  const items = uniq("item");
  const countries = uniq("country");
  const competitors = uniq("competitor");
  const models = uniq("competitor_model");
  const people = uniq("recorded_by");

  const matches = useMemo(() => {
    if (!query.trim()) return items;
    const q = norm(query);
    return items.filter(
      (item) =>
        norm(item).includes(q) ||
        entries.some(
          (e) =>
            e.item === item &&
            (norm(e.competitor).includes(q) ||
              norm(e.competitor_model).includes(q)),
        ),
    );
  }, [items, entries, query]);

  /** item → country → competitor(+model) → observations, newest first */
  const grouped = useMemo(() => {
    const out: Record<string, Record<string, Record<string, PriceEntry[]>>> = {};
    for (const e of entries) {
      if (!matches.includes(e.item)) continue;
      out[e.item] ??= {};
      out[e.item][e.country] ??= {};
      out[e.item][e.country][compKey(e)] ??= [];
      out[e.item][e.country][compKey(e)].push(e);
    }
    for (const item of Object.keys(out))
      for (const country of Object.keys(out[item]))
        for (const key of Object.keys(out[item][country]))
          out[item][country][key].sort(
            (a, b) =>
              b.checked_on.localeCompare(a.checked_on) ||
              b.created_at.localeCompare(a.created_at),
          );
    return out;
  }, [entries, matches]);

  /* -------------------------------------------------------------- photo */

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await compress(file);
      setPendingPhoto(blob);
      setPendingPreview(URL.createObjectURL(blob));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la foto");
    }
  }

  function clearPhoto() {
    setPendingPhoto(null);
    setPendingPreview("");
    setForm((f) => (f ? { ...f, photo_url: "", photo_path: "" } : f));
  }

  /* --------------------------------------------------------------- form */

  const openNew = () =>
    setForm({ ...emptyForm(currentUser), item: query.trim() });

  const openEdit = (e: PriceEntry) =>
    setForm({
      id: e.id,
      item: e.item,
      country: e.country,
      our_price: String(e.our_price ?? ""),
      competitor: e.competitor,
      competitor_model: e.competitor_model ?? "",
      competitor_price: String(e.competitor_price ?? ""),
      checked_on: e.checked_on,
      recorded_by: e.recorded_by || currentUser,
      photo_url: e.photo_url ?? "",
      photo_path: e.photo_path ?? "",
    });

  function closeForm() {
    setForm(null);
    setPendingPhoto(null);
    setPendingPreview("");
    setError("");
  }

  async function save() {
    if (!form) return;
    const missing: string[] = [];
    if (!form.item.trim()) missing.push("Item");
    if (!form.country.trim()) missing.push("País");
    if (!form.competitor.trim()) missing.push("Competidor");
    if (!form.checked_on) missing.push("Fecha");
    if (form.our_price === "" || Number.isNaN(Number(form.our_price)))
      missing.push("Nuestro precio");
    if (form.competitor_price === "" || Number.isNaN(Number(form.competitor_price)))
      missing.push("Precio del competidor");
    if (missing.length) {
      setError("Falta: " + missing.join(", "));
      return;
    }

    setSaving(true);
    setError("");
    try {
      let photo_url = form.photo_url;
      let photo_path = form.photo_path;

      if (pendingPhoto) {
        const path = `${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, pendingPhoto, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        photo_path = path;
        photo_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const row = {
        item: form.item.trim(),
        country: form.country.trim(),
        our_price: Number(form.our_price),
        competitor: form.competitor.trim(),
        competitor_model: form.competitor_model.trim(),
        competitor_price: Number(form.competitor_price),
        checked_on: form.checked_on,
        recorded_by: form.recorded_by.trim() || currentUser,
        photo_url,
        photo_path,
      };

      const { error: dbErr } = form.id
        ? await supabase.from("price_entries").update(row).eq("id", form.id)
        : await supabase.from("price_entries").insert(row);
      if (dbErr) throw dbErr;

      await refresh();
      setQuery(row.item);
      closeForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: PriceEntry) {
    const label =
      `${entry.competitor}${entry.competitor_model ? ` (${entry.competitor_model})` : ""}` +
      ` para ${entry.item} en ${entry.country} (${entry.checked_on})`;
    if (!window.confirm(`¿Borrar el precio de ${label}?`)) return;
    if (entry.photo_path) {
      await supabase.storage.from(BUCKET).remove([entry.photo_path]);
    }
    await supabase.from("price_entries").delete().eq("id", entry.id);
    await refresh();
  }

  /* ----------------------------------------------------------------- csv */

  function exportCsv() {
    const head = [
      "fecha", "item", "pais", "nuestro_precio", "competidor",
      "modelo_competencia", "precio_competidor", "diferencia",
      "tiene_foto", "registrado_por",
    ];
    const rows = entries.map((e) => [
      e.checked_on, e.item, e.country, e.our_price, e.competitor,
      e.competitor_model, e.competitor_price,
      (Number(e.our_price) - Number(e.competitor_price)).toFixed(2),
      e.photo_url ? "sí" : "no", e.recorded_by,
    ]);
    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `precios_competencia_${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* -------------------------------------------------------------- render */

  const field =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900";
  const label = "mb-1 block text-xs font-semibold text-neutral-500";

  return (
    <main className="mx-auto max-w-5xl px-4 pb-28 pt-6">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
        >
          <ArrowLeft size={16} /> Inicio
        </Link>
        <div className="ml-auto flex gap-2">
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            <Download size={15} /> CSV
          </button>
        </div>
      </div>

      <h1 className="text-xl font-semibold tracking-tight">Precios de Competencia</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {entries.length
          ? `${entries.length} registros · ${items.length} items · ${countries.length} países · ${competitors.length} competidores · ${entries.filter((e) => e.photo_url).length} con foto`
          : "Base de datos vacía"}
      </p>

      {/* search */}
      <div className="relative mt-5">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Busca por item, competidor o modelo…"
          className="w-full rounded-xl border border-neutral-300 bg-white py-3.5 pl-11 pr-10 text-base outline-none focus:border-neutral-900"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-900"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* item chips */}
      {items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.slice(0, 40).map((item) => (
            <button
              key={item}
              onClick={() => setQuery(item)}
              className={`rounded-full border px-3 py-1 text-xs ${
                norm(item) === norm(query)
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white hover:bg-neutral-100"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      {/* results */}
      <div className="mt-6 space-y-4">
        {entries.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center">
            <h3 className="font-semibold">Aún no hay precios</h3>
            <p className="mt-1 text-sm text-neutral-500">
              Pulsa <b>Añadir precio</b> para registrar el primero.
            </p>
          </div>
        )}

        {entries.length > 0 && matches.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center">
            <h3 className="font-semibold">Sin resultados para “{query}”</h3>
            <p className="mt-1 text-sm text-neutral-500">
              Prueba con otra parte del nombre, o añádelo como registro nuevo.
            </p>
          </div>
        )}

        {matches.map((item) => {
          const byCountry = grouped[item] ?? {};
          return (
            <section
              key={item}
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
            >
              <h2 className="border-b border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-semibold">
                {item}
              </h2>

              {Object.keys(byCountry)
                .sort((a, b) => a.localeCompare(b, "es"))
                .map((country) => {
                  const lines = byCountry[country];
                  const newest = Object.values(lines)
                    .map((arr) => arr[0])
                    .sort((a, b) => b.checked_on.localeCompare(a.checked_on))[0];

                  return (
                    <div
                      key={country}
                      className="border-b border-neutral-200 px-4 py-4 last:border-b-0"
                    >
                      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-sm font-bold">{country}</span>
                        <span className="text-xs text-neutral-500">
                          Nuestro precio:{" "}
                          <b className="text-sm text-neutral-900">
                            {money(newest.our_price)}
                          </b>
                        </span>
                        <span className="text-xs text-neutral-400">
                          · act. {newest.checked_on}
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-neutral-200 text-[11px] uppercase tracking-wide text-neutral-500">
                              <th className="py-1.5 pr-3 text-left font-semibold">
                                Competidor / Modelo
                              </th>
                              <th className="py-1.5 pr-3 text-left font-semibold">Su precio</th>
                              <th className="py-1.5 pr-3 text-left font-semibold">El nuestro</th>
                              <th className="py-1.5 pr-3 text-left font-semibold">Dif.</th>
                              <th className="hidden py-1.5 pr-3 text-left font-semibold sm:table-cell">%</th>
                              <th className="py-1.5 pr-3 text-left font-semibold">Posición</th>
                              <th className="hidden py-1.5 pr-3 text-left font-semibold sm:table-cell">
                                Últ. check
                              </th>
                              <th className="py-1.5" />
                            </tr>
                          </thead>
                          <tbody>
                            {Object.keys(lines)
                              .sort((a, b) => a.localeCompare(b, "es"))
                              .map((key) => {
                                const [cur, ...history] = lines[key];
                                const ours = Number(cur.our_price);
                                const theirs = Number(cur.competitor_price);
                                const diff = ours - theirs;
                                const pct = theirs ? (diff / theirs) * 100 : 0;
                                const tone =
                                  diff < 0
                                    ? "bg-emerald-50 text-emerald-700"
                                    : diff > 0
                                      ? "bg-red-50 text-red-700"
                                      : "bg-amber-50 text-amber-700";
                                const text =
                                  diff < 0
                                    ? "Somos más baratos"
                                    : diff > 0
                                      ? "Somos más caros"
                                      : "Mismo precio";

                                return (
                                  <tr key={key} className="border-b border-neutral-100 last:border-b-0">
                                    <td className="py-2 pr-3 align-top">
                                      <div className="flex items-start gap-2.5">
                                        {cur.photo_url ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={cur.photo_url}
                                            alt=""
                                            loading="lazy"
                                            onClick={() => setLightbox(cur)}
                                            className="h-11 w-11 shrink-0 cursor-zoom-in rounded-lg border border-neutral-200 object-cover"
                                          />
                                        ) : (
                                          <div
                                            title="Sin foto"
                                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-300"
                                          >
                                            <ImageOff size={16} />
                                          </div>
                                        )}
                                        <div className="min-w-0">
                                          <div className="font-semibold">{cur.competitor}</div>
                                          {cur.competitor_model && (
                                            <div className="text-xs text-neutral-500">
                                              {cur.competitor_model}
                                            </div>
                                          )}
                                          {history.length > 0 && (
                                            <details className="mt-0.5">
                                              <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-900">
                                                Historial ({history.length})
                                              </summary>
                                              <ul className="mt-1 space-y-0.5 pl-3 text-xs text-neutral-500">
                                                {history.map((h) => (
                                                  <li key={h.id}>
                                                    {h.checked_on} — {money(h.competitor_price)}
                                                    {h.recorded_by ? ` · ${h.recorded_by}` : ""}
                                                  </li>
                                                ))}
                                              </ul>
                                            </details>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-2 pr-3 align-top font-semibold tabular-nums">
                                      {money(theirs)}
                                    </td>
                                    <td className="py-2 pr-3 align-top tabular-nums">{money(ours)}</td>
                                    <td className="py-2 pr-3 align-top tabular-nums">
                                      {diff > 0 ? "+" : ""}
                                      {money(diff)}
                                    </td>
                                    <td className="hidden py-2 pr-3 align-top tabular-nums sm:table-cell">
                                      {pct.toFixed(1)}%
                                    </td>
                                    <td className="py-2 pr-3 align-top">
                                      <span
                                        className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}
                                      >
                                        {text}
                                      </span>
                                    </td>
                                    <td className="hidden py-2 pr-3 align-top text-xs text-neutral-500 sm:table-cell">
                                      {cur.checked_on}
                                      {cur.recorded_by && (
                                        <>
                                          <br />
                                          {cur.recorded_by}
                                        </>
                                      )}
                                    </td>
                                    <td className="py-2 align-top">
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() => openEdit(cur)}
                                          title="Editar"
                                          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900"
                                        >
                                          <Pencil size={15} />
                                        </button>
                                        <button
                                          onClick={() => void remove(cur)}
                                          title="Borrar"
                                          className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                                        >
                                          <Trash2 size={15} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
            </section>
          );
        })}
      </div>

      {/* add button */}
      <button
        onClick={openNew}
        className="fixed bottom-6 right-6 z-20 flex items-center gap-2 rounded-full bg-neutral-900 px-5 py-3.5 text-sm font-semibold text-white shadow-lg hover:bg-neutral-700"
      >
        <Plus size={18} /> Añadir precio
      </button>

      {/* datalists shared by the form */}
      <datalist id="dl-items">{items.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-countries">{countries.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-competitors">{competitors.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-models">{models.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="dl-people">{people.map((v) => <option key={v} value={v} />)}</datalist>

      {/* form modal */}
      {form && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-auto bg-black/45 p-4 sm:p-8"
          onClick={(e) => e.target === e.currentTarget && closeForm()}
        >
          <div className="w-full max-w-xl rounded-2xl bg-white p-6">
            <h3 className="text-lg font-semibold">
              {form.id ? "Editar precio" : "Añadir precio"}
            </h3>
            <p className="mt-0.5 text-sm text-neutral-500">
              Cada vez que veas un precio nuevo, añádelo. Los anteriores quedan como historial.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label}>Item *</label>
                <input
                  className={field}
                  list="dl-items"
                  value={form.item}
                  onChange={(e) => setForm({ ...form, item: e.target.value })}
                  placeholder="Nombre de nuestro producto"
                />
              </div>
              <div>
                <label className={label}>País *</label>
                <input
                  className={field}
                  list="dl-countries"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder="Alemania, España, USA…"
                />
              </div>
              <div>
                <label className={label}>Nuestro precio *</label>
                <input
                  className={field}
                  type="number"
                  step="0.01"
                  value={form.our_price}
                  onChange={(e) => setForm({ ...form, our_price: e.target.value })}
                  placeholder="24.90"
                />
              </div>
              <div>
                <label className={label}>Competidor *</label>
                <input
                  className={field}
                  list="dl-competitors"
                  value={form.competitor}
                  onChange={(e) => setForm({ ...form, competitor: e.target.value })}
                  placeholder="Nombre del competidor"
                />
              </div>
              <div>
                <label className={label}>Modelo de la competencia</label>
                <input
                  className={field}
                  list="dl-models"
                  value={form.competitor_model}
                  onChange={(e) => setForm({ ...form, competitor_model: e.target.value })}
                  placeholder="Ref. o modelo que compite"
                />
              </div>
              <div>
                <label className={label}>Precio del competidor *</label>
                <input
                  className={field}
                  type="number"
                  step="0.01"
                  value={form.competitor_price}
                  onChange={(e) => setForm({ ...form, competitor_price: e.target.value })}
                  placeholder="27.50"
                />
              </div>
              <div>
                <label className={label}>Fecha *</label>
                <input
                  className={field}
                  type="date"
                  value={form.checked_on}
                  onChange={(e) => setForm({ ...form, checked_on: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Registrado por</label>
                <input
                  className={field}
                  list="dl-people"
                  value={form.recorded_by}
                  onChange={(e) => setForm({ ...form, recorded_by: e.target.value })}
                  placeholder="Tu nombre"
                />
              </div>

              {/* photo */}
              <div className="sm:col-span-2">
                <label className={label}>Foto del producto de la competencia</label>
                <div className="flex items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3">
                  {pendingPreview || form.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pendingPreview || form.photo_url}
                      alt=""
                      className="h-16 w-16 rounded-lg border border-neutral-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-300">
                      <Camera size={20} />
                    </div>
                  )}
                  <div className="flex-1 text-xs text-neutral-500">
                    {pendingPreview
                      ? "Foto nueva lista para subir."
                      : form.photo_url
                        ? "Foto guardada."
                        : "Se reescala automáticamente antes de subirla."}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => void onPickPhoto(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
                  >
                    Elegir…
                  </button>
                  {(pendingPreview || form.photo_url) && (
                    <button
                      type="button"
                      onClick={clearPhoto}
                      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={closeForm}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/90 p-8"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.photo_url}
            alt=""
            className="max-h-[78vh] max-w-[92vw] rounded-xl bg-white"
          />
          <p className="text-center text-sm font-semibold text-white">
            {lightbox.competitor}
            {lightbox.competitor_model ? ` — ${lightbox.competitor_model}` : ""} ·{" "}
            {lightbox.country} · {money(lightbox.competitor_price)}
          </p>
        </div>
      )}
    </main>
  );
}
