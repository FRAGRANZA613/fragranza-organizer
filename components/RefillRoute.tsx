"use client";

// Refill Route — plan today's stops, send them to Google Maps in order, and
// keep a monthly distance total per driver.
//
// The trip meter uses the phone's GPS but never stores a position anywhere:
// it adds up the distance on the device and, when you stop it, reports a
// single number of kilometres. No location tracking, no location history.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Crosshair,
  Gauge,
  MapPin,
  Navigation,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ types */

export type ScentLine = { scent: string; ml: string; qty: string };

export type Stop = {
  id: string;
  clientId: string | null;
  name: string;
  address: string;
  scents: ScentLine[];
};

export type ClientRow = {
  id: string;
  name: string;
  address: string | null;
  contact: string | null;
  scents: { scent?: string; ml?: string }[] | null;
};

export type MileageRow = {
  id: string;
  driver: string;
  month: string;
  distance_km: number;
  updated_at: string;
};

export type RouteRow = {
  id: string;
  route_date: string;
  driver: string;
  start_address: string;
  stops: Stop[];
  distance_km: number;
  created_at: string;
};

type Lang = "en" | "es";

/* --------------------------------------------------------------- strings */

const T = {
  en: {
    brand: "FRAGRANZA 613", title: "Refill Route",
    sub: "Add today's stops, put them in the order that makes sense, then send the route straight to Maps.",
    home: "Home",
    start: "Starting point", startLabel: "Where you're starting from",
    startPh: "e.g. warehouse address, or leave blank to use current location",
    useCurrent: "Use my current location", addStop: "Add a stop",
    customer: "Customer name", customerPh: "e.g. Christie Robertson",
    address: "Address", addressPh: "Street, city, ZIP",
    scent: "Scent to bring (optional)", scentPh: "e.g. Solaris Vail",
    ml: "ml", qty: "Qty", addScent: "+ Add scent", addStopBtn: "Add stop",
    todays: "Today's stops", none: "No stops yet — add your first one above.",
    hint: "Stops open in Maps in the order shown below. Use the arrows to reorder — put the closest or most time-sensitive stop first. In Google Maps, once the route opens, tap the stops list and choose \"Optimize order\" to let it fine-tune the driving order for you.",
    mileage: "This month's distance", yourName: "Your name", namePh: "e.g. Miguel",
    addKm: "Add km by hand", correct: "Correct my total",
    startTrip: "Start trip meter", stopTrip: "Stop and save",
    running: "Measuring — ", thisTrip: "this trip",
    kmNote: "The trip meter uses your phone's GPS and adds up the distance on the device. Nothing about where you are is ever sent or stored — only the total kilometres when you stop it. You can also add or correct the number by hand.",
    open: "Open route in Google Maps", added: "stops added",
    needName: "Write your name first.",
    noGeo: "This device won't give the browser its location.",
    tooMany: "Google Maps takes up to 10 stops per route. Only the first 10 will open.",
    history: "Recent routes", stopsWord: "stops", clear: "Clear list",
  },
  es: {
    brand: "FRAGRANZA 613", title: "Ruta de Recarga",
    sub: "Agrega las paradas de hoy, ponlas en el orden que tenga sentido y manda la ruta directo a Maps.",
    home: "Inicio",
    start: "Punto de partida", startLabel: "Desde dónde sales",
    startPh: "ej. dirección del depósito, o déjalo vacío para usar tu ubicación",
    useCurrent: "Usar mi ubicación actual", addStop: "Agregar parada",
    customer: "Nombre del cliente", customerPh: "ej. Christie Robertson",
    address: "Dirección", addressPh: "Calle, ciudad",
    scent: "Aroma a llevar (opcional)", scentPh: "ej. Solaris Vail",
    ml: "ml", qty: "Cant.", addScent: "+ Agregar aroma", addStopBtn: "Agregar parada",
    todays: "Paradas de hoy", none: "Aún no hay paradas — agrega la primera arriba.",
    hint: "Las paradas se abren en Maps en el orden de abajo. Usa las flechas para reordenar — pon primero la más cercana o la más urgente. Ya en Google Maps, toca la lista de paradas y elige \"Optimizar orden\" para que ajuste el orden de manejo por ti.",
    mileage: "Kilometraje del mes", yourName: "Tu nombre", namePh: "ej. Miguel",
    addKm: "Agregar km a mano", correct: "Corregir mi total",
    startTrip: "Empezar a medir el viaje", stopTrip: "Parar y guardar",
    running: "Midiendo — ", thisTrip: "este viaje",
    kmNote: "El medidor usa el GPS del teléfono y suma la distancia en el propio aparato. Nunca se envía ni se guarda dónde estás — solo el total de kilómetros cuando lo paras. También puedes agregar o corregir el número a mano.",
    open: "Abrir ruta en Google Maps", added: "paradas agregadas",
    needName: "Escribe tu nombre primero.",
    noGeo: "Este dispositivo no le da la ubicación al navegador.",
    tooMany: "Google Maps acepta hasta 10 paradas por ruta. Solo se abrirán las primeras 10.",
    history: "Rutas recientes", stopsWord: "paradas", clear: "Vaciar lista",
  },
} as const;

/* ------------------------------------------------------------- utilities */

const uid = () => Math.random().toString(36).slice(2, 10);
const emptyScent = (): ScentLine => ({ scent: "", ml: "", qty: "" });

const km = (n: number) =>
  Number(n).toLocaleString("es-PA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Great-circle distance in km between two fixes. */
function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ------------------------------------------------------------- component */

export function RefillRoute({
  clients,
  initialMileage,
  initialRoutes,
  month,
  currentUser,
}: {
  clients: ClientRow[];
  initialMileage: MileageRow[];
  initialRoutes: RouteRow[];
  month: string;
  currentUser: string;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [lang, setLang] = useState<Lang>("es");
  const t = T[lang];

  const [startAddress, setStartAddress] = useState("");
  const [stops, setStops] = useState<Stop[]>([]);
  const [draft, setDraft] = useState<Stop>({
    id: uid(), clientId: null, name: "", address: "", scents: [emptyScent()],
  });

  const [driverName, setDriverName] = useState("");
  const [mileage, setMileage] = useState<MileageRow[]>(initialMileage);
  const [routes, setRoutes] = useState<RouteRow[]>(initialRoutes);

  const [measuring, setMeasuring] = useState(false);
  const [tripKm, setTripKm] = useState(0);
  const [notice, setNotice] = useState("");

  const watchId = useRef<number | null>(null);
  const lastFix = useRef<{ lat: number; lng: number } | null>(null);
  const pendingKm = useRef(0);

  /* remember name and language between visits */
  useEffect(() => {
    const savedName = window.localStorage.getItem("ruta_driver");
    if (savedName) setDriverName(savedName);
    const savedLang = window.localStorage.getItem("ruta_lang");
    if (savedLang === "en" || savedLang === "es") setLang(savedLang);
  }, []);
  useEffect(() => {
    if (driverName) window.localStorage.setItem("ruta_driver", driverName);
  }, [driverName]);
  useEffect(() => {
    window.localStorage.setItem("ruta_lang", lang);
  }, [lang]);

  /* ------------------------------------------------------------- refresh */

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("mileage_totals").select("*").eq("month", month)
      .order("distance_km", { ascending: false });
    if (data) setMileage(data as MileageRow[]);
  }, [supabase, month]);

  useEffect(() => {
    const ch = supabase
      .channel("ruta_mileage")
      .on("postgres_changes", { event: "*", schema: "public", table: "mileage_totals" },
        () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, refresh]);

  /* ---------------------------------------------------------- stop draft */

  const clientNames = useMemo(() => clients.map((c) => c.name).filter(Boolean), [clients]);

  function pickClient(name: string) {
    const c = clients.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!c) {
      setDraft((d) => ({ ...d, name, clientId: null }));
      return;
    }
    const scents: ScentLine[] = (c.scents ?? [])
      .filter((s) => (s?.scent ?? "").trim() !== "")
      .map((s) => ({ scent: s.scent ?? "", ml: s.ml ?? "", qty: "1" }));
    setDraft({
      id: uid(),
      clientId: c.id,
      name: c.name,
      address: c.address ?? "",
      scents: scents.length ? scents : [emptyScent()],
    });
  }

  function addStop() {
    if (!draft.name.trim() && !draft.address.trim()) return;
    const clean = draft.scents.filter((s) => s.scent.trim() !== "");
    setStops((s) => [...s, { ...draft, id: uid(), scents: clean }]);
    setDraft({ id: uid(), clientId: null, name: "", address: "", scents: [emptyScent()] });
  }

  const move = (i: number, dir: -1 | 1) =>
    setStops((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const removeStop = (id: string) => setStops((s) => s.filter((x) => x.id !== id));

  /* ------------------------------------------------------------- geo/maps */

  function useCurrentLocation() {
    if (!navigator.geolocation) { setNotice(t.noGeo); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setStartAddress(`${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)}`),
      () => setNotice(t.noGeo),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function mapsUrl() {
    const withAddress = stops.filter((s) => s.address.trim() !== "");
    if (!withAddress.length) return "";
    const capped = withAddress.slice(0, 10);
    const params = new URLSearchParams();
    params.set("api", "1");
    if (startAddress.trim()) params.set("origin", startAddress.trim());
    params.set("destination", capped[capped.length - 1].address.trim());
    if (capped.length > 1) {
      params.set("waypoints", capped.slice(0, -1).map((s) => s.address.trim()).join("|"));
    }
    params.set("travelmode", "driving");
    // URLSearchParams encodes "|" as %7C, which Maps accepts.
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  async function openRoute() {
    const url = mapsUrl();
    if (!url) return;
    if (stops.filter((s) => s.address.trim()).length > 10) setNotice(t.tooMany);

    await supabase.from("routes").insert({
      route_date: new Date().toISOString().slice(0, 10),
      driver: driverName || currentUser,
      start_address: startAddress,
      stops,
      distance_km: 0,
      opened_at: new Date().toISOString(),
      created_by: currentUser,
    });

    const { data } = await supabase.from("routes").select("*")
      .order("route_date", { ascending: false })
      .order("created_at", { ascending: false }).limit(25);
    if (data) setRoutes(data as RouteRow[]);

    window.open(url, "_blank", "noopener,noreferrer");
  }

  /* ------------------------------------------------------------- mileage */

  const who = () => driverName.trim() || currentUser;
  const myTotal = mileage.find((m) => m.driver.toLowerCase() === who().toLowerCase());

  async function addKm(amount: number) {
    if (!who()) { setNotice(t.needName); return; }
    await supabase.rpc("add_mileage", { p_driver: who(), p_month: month, p_km: amount });
    await refresh();
  }

  async function setTotal(value: number) {
    if (!who()) { setNotice(t.needName); return; }
    await supabase.from("mileage_totals")
      .upsert({ driver: who(), month, distance_km: value }, { onConflict: "driver,month" });
    await refresh();
  }

  /* ---------------------------------------------------------- trip meter */

  function startTrip() {
    if (!who()) { setNotice(t.needName); return; }
    if (!navigator.geolocation) { setNotice(t.noGeo); return; }

    setNotice("");
    setTripKm(0);
    pendingKm.current = 0;
    lastFix.current = null;
    setMeasuring(true);

    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude: lat, longitude: lng, accuracy } = p.coords;
        // Ignore noisy fixes; they inflate distance while standing still.
        if (accuracy > 60) return;
        const prev = lastFix.current;
        if (prev) {
          const step = haversine(prev.lat, prev.lng, lat, lng);
          if (step > 0.02 && step < 5) {
            pendingKm.current += step;
            setTripKm((k) => k + step);
          }
        }
        lastFix.current = { lat, lng };
      },
      () => { setNotice(t.noGeo); setMeasuring(false); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  async function stopTrip() {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setMeasuring(false);
    lastFix.current = null;
    if (who() && pendingKm.current > 0.05) {
      await supabase.rpc("add_mileage", {
        p_driver: who(), p_month: month, p_km: Number(pendingKm.current.toFixed(2)),
      });
      await refresh();
    }
    pendingKm.current = 0;
  }

  useEffect(() => {
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, []);

  /* -------------------------------------------------------------- render */

  const field =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900";
  const label = "mb-1 block text-xs font-semibold text-neutral-500";
  const card = "rounded-xl border border-neutral-200 bg-white p-4";

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-6">
      {/* header */}
      <div className="mb-4 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900">
          <ArrowLeft size={16} /> {t.home}
        </Link>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-neutral-300">
          {(["en", "es"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-2.5 py-1 text-xs font-semibold uppercase ${
                lang === l ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-100"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
        {t.brand}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-1 text-sm text-neutral-500">{t.sub}</p>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice("")} className="text-amber-700">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {/* starting point */}
        <section className={card}>
          <h2 className="text-sm font-semibold">{t.start}</h2>
          <label className={`${label} mt-2`}>{t.startLabel}</label>
          <input
            className={field}
            value={startAddress}
            onChange={(e) => setStartAddress(e.target.value)}
            placeholder={t.startPh}
          />
          <button
            onClick={useCurrentLocation}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            <Crosshair size={15} /> {t.useCurrent}
          </button>
        </section>

        {/* add a stop */}
        <section className={card}>
          <h2 className="text-sm font-semibold">{t.addStop}</h2>

          <label className={`${label} mt-2`}>{t.customer}</label>
          <input
            className={field}
            list="ruta-clients"
            value={draft.name}
            onChange={(e) => pickClient(e.target.value)}
            placeholder={t.customerPh}
          />
          <datalist id="ruta-clients">
            {clientNames.map((n) => <option key={n} value={n} />)}
          </datalist>

          <label className={`${label} mt-3`}>{t.address}</label>
          <input
            className={field}
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            placeholder={t.addressPh}
          />

          <label className={`${label} mt-3`}>{t.scent}</label>
          <div className="space-y-2">
            {draft.scents.map((s, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={`${field} flex-1`}
                  value={s.scent}
                  onChange={(e) => {
                    const next = [...draft.scents];
                    next[i] = { ...next[i], scent: e.target.value };
                    setDraft({ ...draft, scents: next });
                  }}
                  placeholder={t.scentPh}
                />
                <input
                  className={`${field} w-20`}
                  value={s.ml}
                  onChange={(e) => {
                    const next = [...draft.scents];
                    next[i] = { ...next[i], ml: e.target.value };
                    setDraft({ ...draft, scents: next });
                  }}
                  placeholder={t.ml}
                />
                <input
                  className={`${field} w-20`}
                  value={s.qty}
                  onChange={(e) => {
                    const next = [...draft.scents];
                    next[i] = { ...next[i], qty: e.target.value };
                    setDraft({ ...draft, scents: next });
                  }}
                  placeholder={t.qty}
                />
              </div>
            ))}
          </div>
          <button
            onClick={() => setDraft({ ...draft, scents: [...draft.scents, emptyScent()] })}
            className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            {t.addScent}
          </button>

          <button
            onClick={addStop}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            <Plus size={16} /> {t.addStopBtn}
          </button>
        </section>

        {/* today's stops */}
        <section className={card}>
          <div className="flex items-center">
            <h2 className="text-sm font-semibold">{t.todays}</h2>
            {stops.length > 0 && (
              <button
                onClick={() => setStops([])}
                className="ml-auto text-xs text-neutral-500 hover:text-red-600"
              >
                {t.clear}
              </button>
            )}
          </div>

          {stops.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">{t.none}</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {stops.map((s, i) => (
                <li key={s.id} className="flex gap-3 rounded-lg border border-neutral-200 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name || s.address}</p>
                    {s.address && (
                      <p className="flex items-center gap-1 truncate text-xs text-neutral-500">
                        <MapPin size={11} /> {s.address}
                      </p>
                    )}
                    {s.scents.length > 0 && (
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {s.scents
                          .map((x) => [x.scent, x.ml && `${x.ml} ml`, x.qty && `×${x.qty}`]
                            .filter(Boolean).join(" "))
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <button onClick={() => move(i, -1)} disabled={i === 0}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30">
                      <ArrowUp size={14} />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === stops.length - 1}
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30">
                      <ArrowDown size={14} />
                    </button>
                    <button onClick={() => removeStop(s.id)}
                      className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <p className="mt-3 border-t border-neutral-100 pt-3 text-xs leading-relaxed text-neutral-500">
            {t.hint}
          </p>
        </section>

        {/* mileage */}
        <section className={card}>
          <h2 className="text-sm font-semibold">{t.mileage}</h2>

          <label className={`${label} mt-2`}>{t.yourName}</label>
          <input
            className={field}
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            placeholder={t.namePh}
          />

          <div className="mt-3 rounded-lg bg-neutral-50 p-3">
            <div className="text-2xl font-semibold">
              {km(myTotal?.distance_km ?? 0)}{" "}
              <span className="text-base font-normal text-neutral-500">km</span>
            </div>
            <div className="text-xs text-neutral-500">{month}</div>
          </div>

          {measuring && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              <Gauge size={15} className="animate-pulse" />
              <span>
                {t.running}
                <b>{km(tripKm)} km</b> {t.thisTrip}
              </span>
            </div>
          )}

          <button
            onClick={() => (measuring ? void stopTrip() : startTrip())}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold ${
              measuring
                ? "border border-red-200 bg-white text-red-600 hover:bg-red-50"
                : "bg-neutral-900 text-white hover:bg-neutral-700"
            }`}
          >
            <Gauge size={16} /> {measuring ? t.stopTrip : t.startTrip}
          </button>

          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                const v = window.prompt(t.addKm, "0");
                const n = Number((v ?? "").replace(",", "."));
                if (Number.isFinite(n) && n !== 0) void addKm(n);
              }}
              className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            >
              {t.addKm}
            </button>
            <button
              onClick={() => {
                const v = window.prompt(t.correct, String(myTotal?.distance_km ?? 0));
                const n = Number((v ?? "").replace(",", "."));
                if (Number.isFinite(n) && n >= 0) void setTotal(n);
              }}
              className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            >
              {t.correct}
            </button>
          </div>

          {mileage.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-neutral-100 pt-3">
              {mileage.map((m) => (
                <li key={m.id} className="flex justify-between text-sm">
                  <span className="text-neutral-600">{m.driver}</span>
                  <span className="font-semibold tabular-nums">{km(m.distance_km)} km</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-xs leading-relaxed text-neutral-500">{t.kmNote}</p>
        </section>

        {/* recent routes */}
        {routes.length > 0 && (
          <section className={card}>
            <h2 className="text-sm font-semibold">{t.history}</h2>
            <ul className="mt-2 space-y-1">
              {routes.slice(0, 8).map((r) => (
                <li key={r.id} className="flex justify-between gap-3 text-sm">
                  <span className="truncate text-neutral-600">
                    {r.route_date} · {r.driver || "—"}
                  </span>
                  <span className="shrink-0 text-neutral-500">
                    {(r.stops ?? []).length} {t.stopsWord}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* sticky footer */}
      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <p className="mb-2 text-center text-xs text-neutral-500">
            {stops.length} {t.added}
          </p>
          <button
            onClick={() => void openRoute()}
            disabled={stops.filter((s) => s.address.trim()).length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            <Navigation size={16} /> {t.open}
          </button>
        </div>
      </div>
    </main>
  );
}
