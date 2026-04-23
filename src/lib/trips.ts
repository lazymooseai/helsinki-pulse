/**
 * trips.ts
 *
 * Apufunktiot kyytihistorialle: tiedoston parsinta (CSV/XLSX),
 * validointi, tallennus, kysely ja CSV-export.
 */
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { resolveAreaName } from "./areas";

export interface TaxiTripRow {
  trip_id: string;
  start_time: string;
  end_time?: string | null;
  start_address?: string | null;
  start_lat?: number | null;
  start_lon?: number | null;
  end_address?: string | null;
  end_lat?: number | null;
  end_lon?: number | null;
  fare_eur?: number | null;
  distance_km?: number | null;
  duration_min?: number | null;
  vehicle_id?: string | null;
  payment_method?: string | null;
  source_file?: string | null;
}

export interface TaxiTripStored extends TaxiTripRow {
  id: string;
  hour_of_day: number | null;
  day_of_week: number | null;
  is_weekend: boolean | null;
  week_number: number | null;
  month_num: number | null;
  created_at: string;
}

/** Palauttaa nimetyn alueen lähtökoordinaatista (esim. "Kamppi", "Pasilan asema"). */
export function tripStartArea(t: Pick<TaxiTripStored, "start_address" | "start_lat" | "start_lon">): string {
  return resolveAreaName(t.start_address, t.start_lat, t.start_lon);
}

/** Palauttaa nimetyn alueen kohdekoordinaatista. */
export function tripEndArea(t: Pick<TaxiTripStored, "end_address" | "end_lat" | "end_lon">): string {
  return resolveAreaName(t.end_address, t.end_lat, t.end_lon);
}

export interface TripFilters {
  search?: string;          // tekstihaku osoitteesta
  hourMin?: number;
  hourMax?: number;
  daysOfWeek?: number[];    // 1-7 (ISO, ma=1)
  fareMin?: number;
  fareMax?: number;
  limit?: number;
}

export interface TripStats {
  count: number;
  avgFare: number;
  avgDistance: number;
  topStartArea: string | null;
  topStartAreaCount: number;
}

/* ── Tiedoston parsinta ───────────────────────────────────────── */

const REQUIRED_HEADERS = ["trip_id", "start_time"];

const ALL_HEADERS = [
  "trip_id", "start_time", "end_time",
  "start_address", "start_lat", "start_lon",
  "end_address", "end_lat", "end_lon",
  "fare_eur", "distance_km", "duration_min",
  "vehicle_id", "payment_method",
] as const;

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.round(n);
}

function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  // Excel serial number?
  if (typeof v === "number") {
    // Excelin epoch 1899-12-30
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

export interface ParseResult {
  rows: TaxiTripRow[];
  errors: string[];
  totalRows: number;
  fileName: string;
}

export async function parseTripsFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: ["Tiedostossa ei ole välilehtiä"], totalRows: 0, fileName: file.name };
  }
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });

  const errors: string[] = [];
  if (json.length === 0) {
    errors.push("Tiedostossa ei ole rivejä");
    return { rows: [], errors, totalRows: 0, fileName: file.name };
  }

  // Tarkista pakolliset headerit
  const firstRowKeys = Object.keys(json[0]).map((k) => k.toLowerCase().trim());
  const missing = REQUIRED_HEADERS.filter((h) => !firstRowKeys.includes(h));
  if (missing.length > 0) {
    errors.push(`Pakolliset sarakkeet puuttuvat: ${missing.join(", ")}`);
    return { rows: [], errors, totalRows: json.length, fileName: file.name };
  }

  const rows: TaxiTripRow[] = [];
  json.forEach((raw, idx) => {
    // Normalisoi avaimet pieniksi
    const r: Record<string, unknown> = {};
    for (const k of Object.keys(raw)) r[k.toLowerCase().trim()] = raw[k];

    const trip_id = toStr(r.trip_id);
    const start_time = toIsoDate(r.start_time);
    if (!trip_id) {
      errors.push(`Rivi ${idx + 2}: trip_id puuttuu`);
      return;
    }
    if (!start_time) {
      errors.push(`Rivi ${idx + 2}: start_time virheellinen`);
      return;
    }

    rows.push({
      trip_id,
      start_time,
      end_time: toIsoDate(r.end_time),
      start_address: toStr(r.start_address),
      start_lat: toNumber(r.start_lat),
      start_lon: toNumber(r.start_lon),
      end_address: toStr(r.end_address),
      end_lat: toNumber(r.end_lat),
      end_lon: toNumber(r.end_lon),
      fare_eur: toNumber(r.fare_eur),
      distance_km: toNumber(r.distance_km),
      duration_min: toInt(r.duration_min),
      vehicle_id: toStr(r.vehicle_id),
      payment_method: toStr(r.payment_method),
      source_file: file.name,
    });
  });

  return { rows, errors, totalRows: json.length, fileName: file.name };
}

/* ── Tallennus (duplikaattien ohitus trip_id:n perusteella) ──── */

export interface ImportResult {
  inserted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export async function importTrips(rows: TaxiTripRow[]): Promise<ImportResult> {
  if (rows.length === 0) return { inserted: 0, skipped: 0, failed: 0, errors: [] };

  // Hae olemassaolevat trip_id:t (chunked)
  const existingIds = new Set<string>();
  const ids = rows.map((r) => r.trip_id);
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("taxi_trips")
      .select("trip_id")
      .in("trip_id", chunk);
    if (error) return { inserted: 0, skipped: 0, failed: rows.length, errors: [error.message] };
    data?.forEach((d) => existingIds.add(d.trip_id));
  }

  const newRows = rows.filter((r) => !existingIds.has(r.trip_id));
  const skipped = rows.length - newRows.length;
  if (newRows.length === 0) return { inserted: 0, skipped, failed: 0, errors: [] };

  // Insertoi chunked
  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < newRows.length; i += chunkSize) {
    const chunk = newRows.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from("taxi_trips")
      .insert(chunk, { count: "exact" });
    if (error) {
      failed += chunk.length;
      errors.push(error.message);
    } else {
      inserted += count ?? chunk.length;
    }
  }

  return { inserted, skipped, failed, errors };
}

export async function insertSingleTrip(row: TaxiTripRow): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("taxi_trips").insert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ── Haku ──────────────────────────────────────────────────────── */

export async function queryTrips(filters: TripFilters): Promise<TaxiTripStored[]> {
  let q = supabase
    .from("taxi_trips")
    .select("*")
    .order("start_time", { ascending: false })
    .limit(filters.limit ?? 500);

  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim();
    q = q.or(`start_address.ilike.%${s}%,end_address.ilike.%${s}%`);
  }
  if (typeof filters.hourMin === "number") q = q.gte("hour_of_day", filters.hourMin);
  if (typeof filters.hourMax === "number") q = q.lte("hour_of_day", filters.hourMax);
  if (filters.daysOfWeek && filters.daysOfWeek.length > 0) {
    q = q.in("day_of_week", filters.daysOfWeek);
  }
  if (typeof filters.fareMin === "number") q = q.gte("fare_eur", filters.fareMin);
  if (typeof filters.fareMax === "number") q = q.lte("fare_eur", filters.fareMax);

  const { data, error } = await q;
  if (error) {
    console.error("queryTrips error", error);
    return [];
  }
  return (data ?? []) as TaxiTripStored[];
}

export function computeStats(trips: TaxiTripStored[]): TripStats {
  if (trips.length === 0) {
    return { count: 0, avgFare: 0, avgDistance: 0, topStartArea: null, topStartAreaCount: 0 };
  }
  let fareSum = 0, fareN = 0, distSum = 0, distN = 0;
  const areaCounts = new Map<string, number>();
  for (const t of trips) {
    if (typeof t.fare_eur === "number") { fareSum += t.fare_eur; fareN++; }
    if (typeof t.distance_km === "number") { distSum += t.distance_km; distN++; }
    const a = (t.start_address ?? "").trim();
    if (a) areaCounts.set(a, (areaCounts.get(a) ?? 0) + 1);
  }
  let topArea: string | null = null;
  let topCount = 0;
  for (const [a, c] of areaCounts.entries()) {
    if (c > topCount) { topArea = a; topCount = c; }
  }
  return {
    count: trips.length,
    avgFare: fareN > 0 ? fareSum / fareN : 0,
    avgDistance: distN > 0 ? distSum / distN : 0,
    topStartArea: topArea,
    topStartAreaCount: topCount,
  };
}

export function tripsToCsv(trips: TaxiTripStored[]): string {
  const headers = [...ALL_HEADERS, "hour_of_day", "day_of_week", "is_weekend"];
  const rows = trips.map((t) =>
    headers
      .map((h) => {
        const v = (t as unknown as Record<string, unknown>)[h];
        if (v === null || v === undefined) return "";
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(","),
  );
  return [headers.join(","), ...rows].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Analytiikka ──────────────────────────────────────────────── */

export interface TodayStats {
  count: number;
  avgFare: number;
  totalRevenue: number;
}

export async function getTodayStats(): Promise<TodayStats> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("taxi_trips")
    .select("fare_eur")
    .gte("start_time", start.toISOString());
  if (error || !data) return { count: 0, avgFare: 0, totalRevenue: 0 };
  const fares = data.map((d) => d.fare_eur).filter((f): f is number => typeof f === "number");
  const total = fares.reduce((a, b) => a + b, 0);
  return {
    count: data.length,
    avgFare: fares.length > 0 ? total / fares.length : 0,
    totalRevenue: total,
  };
}

export interface PatternRow {
  hour_of_day: number;
  day_of_week: number;
  start_area: string;
  trip_count: number;
  avg_fare: number;
  avg_distance: number;
}

/**
 * Hakee tämän hetken (tunti × viikonpäivä) historialliset patternit.
 * Palauttaa kokonaismäärän + parhaan lähtöalueen.
 */
export async function getCurrentHourPattern(): Promise<{
  totalTrips: number;
  bestArea: string | null;
  bestAreaCount: number;
}> {
  const now = new Date();
  // Käytä Helsingin aikaa (näkymä on jo Helsinki-aikavyöhykkeellä)
  const hour = now.getHours();
  const isoDow = ((now.getDay() + 6) % 7) + 1; // ma=1 ... su=7

  // trip_patterns ei ole types.ts:ssä → käytetään raw RPC -tyylillä `from` minkä TS ei tunne.
  // Käytetään suoraa fetchia REST-rajapintaan, jotta saadaan näkymästä tiedot.
  const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/trip_patterns?hour_of_day=eq.${hour}&day_of_week=eq.${isoDow}&select=start_area,trip_count`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
    });
    if (!res.ok) return { totalTrips: 0, bestArea: null, bestAreaCount: 0 };
    const rows = (await res.json()) as Array<{ start_area: string; trip_count: number }>;
    let total = 0;
    let best: string | null = null;
    let bestC = 0;
    for (const r of rows) {
      total += r.trip_count;
      if (r.trip_count > bestC) { bestC = r.trip_count; best = r.start_area; }
    }
    return { totalTrips: total, bestArea: best, bestAreaCount: bestC };
  } catch (e) {
    console.error("getCurrentHourPattern error", e);
    return { totalTrips: 0, bestArea: null, bestAreaCount: 0 };
  }
}

export const DAY_LABELS_FI = ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"];
export const PAYMENT_METHODS = ["kortti", "käteinen", "lasku"] as const;