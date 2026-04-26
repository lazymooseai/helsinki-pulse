/**
 * prebookings.ts
 *
 * Data-kerros ennakkotilauksille (pre_bookings).
 * Sisaltaa AI-luennan (scan-prebookings), tekstijasennyksen, CRUD:n.
 */

import { supabase } from "@/integrations/supabase/client";
import { htmlToText } from "@/lib/dispatchScans";

export interface PreBooking {
  id: string;
  tolppa: string;
  pickup_at: string; // ISO
  source: string;
  notes: string | null;
  raw_text: string | null;
  ocr_confidence: number | null;
  scanned_by_device: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParsedBooking {
  tolppa: string;
  pickup_at: string;
  confidence?: number;
}

export type BookingsCallResult =
  | { ok: true; bookings: ParsedBooking[]; raw_text?: string; error?: undefined }
  | { ok: false; error: string; bookings?: undefined };

// ---------- Helsinki-aikavyohyke -apurit ----------

/** Palauttaa Europe/Helsinki -offsetin minuuteissa annetulle UTC-hetkelle (180 = +03:00). */
function helsinkiOffsetMinutes(at: Date): number {
  // Format date in Helsinki timezone, then diff against UTC
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(at).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour === "24" ? "0" : parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Yhdistaa Helsinki-paivamaaran (Y/M/D) + Helsinki-kellonajan (H/M) → ISO UTC.
 * Toimii oikein riippumatta selaimen aikavyohykkeesta.
 */
function helsinkiDateTimeToIso(year: number, month: number, day: number, hour: number, minute: number): string {
  // Naiivi UTC-aika "ikaan kuin se olisi Helsinki-aika"
 const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Lasketaan offset talle hetkelle (DST huomioiden)
  const offsetMin = helsinkiOffsetMinutes(new Date(naiveUtcMs));
  const realUtcMs = naiveUtcMs - offsetMin * 60_000;
  return new Date(realUtcMs).toISOString();
}

/** Palauttaa Helsinki-kalenteripaivan (Y/M/D) annetulle hetkelle. */
function helsinkiYmd(at: Date): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = dtf.format(at).split("-").map((s) => parseInt(s, 10));
  return { year, month, day };
}

/** Ajaa kuvan AI:n lapi → array ennakkotilauksia. */
export async function runImageBookings(dataUrl: string): Promise<BookingsCallResult> {
  return invokeScanPrebookings({ image: dataUrl });
}

/** Ajaa PDF:n AI:n lapi → array ennakkotilauksia. */
export async function runPdfBookings(pdfDataUrl: string): Promise<BookingsCallResult> {
  return invokeScanPrebookings({ pdf: pdfDataUrl });
}

async function invokeScanPrebookings(body: Record<string, unknown>): Promise<BookingsCallResult> {
  try {
    const { data, error } = await supabase.functions.invoke("scan-prebookings", {
      body: { ...body, reference_date: new Date().toISOString().slice(0, 10) },
    });
    if (error) {
      return { ok: false, error: error.message ?? "AI-luenta epaonnistui" };
    }
    if (!data || !Array.isArray(data.bookings)) {
      return { ok: false, error: data?.error ?? "AI ei palauttanut ennakkotilauksia" };
    }
    return { ok: true, bookings: data.bookings as ParsedBooking[], raw_text: data.raw_text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "tuntematon virhe" };
  }
}

/**
 * Jasenna teksti (TXT/CSV/JSON/HTML) → array ennakkotilauksia.
 * Tunnistaa rivit muotoa: "14:30  Rautatientori" tai "Kamppi - 15:00" tai
 * CSV "Kamppi,2026-04-26 15:00".
 */
export function parseTextToBookings(raw: string, baseDate = new Date()): BookingsCallResult {
  const looksLikeHtml = /<\/?[a-z][\s\S]*?>/i.test(raw) && /<(html|body|div|span|table|p|td|th|li|h\d)\b/i.test(raw);
  const text = (looksLikeHtml ? htmlToText(raw) : raw).trim();
  if (!text) return { ok: false, error: "Tiedosto on tyhja" };

  // 1. JSON array
  try {
    const obj = JSON.parse(text);
    if (Array.isArray(obj)) {
      const out: ParsedBooking[] = [];
      for (const r of obj) {
        if (r && typeof r === "object" && r.tolppa && r.pickup_at) {
          out.push({
            tolppa: String(r.tolppa).slice(0, 100),
            pickup_at: normalizeIso(String(r.pickup_at), baseDate),
            confidence: typeof r.confidence === "number" ? r.confidence : 0.95,
          });
        }
      }
      if (out.length) return { ok: true, bookings: out };
    }
  } catch {
    // jatka
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bookings: ParsedBooking[] = [];
  for (const line of lines) {
    const parsed = parseBookingLine(line, baseDate);
    if (parsed) bookings.push(parsed);
  }

  if (bookings.length === 0) {
    return { ok: false, error: "Tekstista ei loytynyt ennakkotilauksia (rivi: aika + tolppa)" };
  }
  return { ok: true, bookings };
}

/**
 * Yhdelta rivilta → ParsedBooking, jos siita loytyy aika ja tolppa.
 * Tukee:
 *   "14:30  Rautatientori"
 *   "Kamppi - 15:00"
 *   "2026-04-26 14:30 Tikkurila"
 *   "Kamppi,2026-04-26T14:30"
 *   CSV: "Kamppi,14:30"
 */
function parseBookingLine(line: string, baseDate: Date): ParsedBooking | null {
  // Siivoa Markdown-merkit (**, *, _, `) jotta AI-vastauksetkin parsiutuvat
  const cleanLine = line
    .replace(/[*_`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanLine) return null;

  // Skip ilmiselvat otsikot ja metarivit
  if (/^(aika|kellonaika|tolppa|paikka|nouto|time|location|paiv[aä]m[aä][aä]r[aä]|tilaus|order|bookings?:?$)/i.test(cleanLine)) return null;

  // ISO datetime
  const isoMatch = cleanLine.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?)/);
  // Suomalainen paivamaara dd.mm.yyyy + kellonaika klo HH:MM
  const fiDateMatch = cleanLine.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(?:klo\s*)?(\d{1,2})[:.](\d{2})/i);
  // Pelkka kellonaika HH:MM (24h)
  const timeMatch = cleanLine.match(/\b(\d{1,2})[:.](\d{2})\b/);

  if (!isoMatch && !fiDateMatch && !timeMatch) return null;

  let isoStr: string;
  let timeText: string;
  if (isoMatch) {
    isoStr = normalizeIso(isoMatch[1], baseDate);
    timeText = isoMatch[1];
  } else if (fiDateMatch) {
    const day = parseInt(fiDateMatch[1], 10);
    const month = parseInt(fiDateMatch[2], 10);
    const year = parseInt(fiDateMatch[3], 10);
    const h = parseInt(fiDateMatch[4], 10);
    const m = parseInt(fiDateMatch[5], 10);
    if (h > 23 || m > 59 || month > 12 || day > 31) return null;
    isoStr = helsinkiDateTimeToIso(year, month, day, h, m);
    timeText = fiDateMatch[0];
  } else {
    const h = parseInt(timeMatch![1], 10);
    const m = parseInt(timeMatch![2], 10);
    if (h > 23 || m > 59) return null;
    isoStr = combineDateTime(baseDate, h, m);
    timeText = timeMatch![0];
  }

  // Loput rivista on tolppa (poista aika + erottimet)
  let rest = cleanLine
    .replace(timeText, "")
    .replace(/\bklo\b/gi, "")
    .replace(/[,;|\t]+/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!rest || rest.length < 2) return null;
  // Jos jaa pelkka numero, ei kelpaa tolppanimeksi
  if (/^\d+$/.test(rest)) return null;
  // Hylkaa rivit, joissa on edelleen pelkkaa metatekstia ilman oikeaa tolpan nimea
  if (/^(p[aä]iv[aä]m[aä][aä]r[aä]|aika|kellonaika|nouto)/i.test(rest)) return null;
  // Vaadi vahintaan 3 merkkia ja vahintaan yksi kirjain
  if (rest.length < 3 || !/[a-zA-ZäöåÄÖÅ]/.test(rest)) return null;

  return {
    tolppa: rest.slice(0, 100),
    pickup_at: isoStr,
    confidence: 0.9,
  };
}

/**
 * Yhdistaa annetun paivan + kellonajan ISO:ksi.
 * KAYTTAA aina Europe/Helsinki -aikavyohyketta (riippumatta selaimen tz:sta).
 */
function combineDateTime(base: Date, hour: number, minute: number): string {
  const { year, month, day } = helsinkiYmd(base);
  let iso = helsinkiDateTimeToIso(year, month, day, hour, minute);
  // Jos aika on jo mennyt > 6h sitten, ohjaa huomiseen
  if (new Date(iso).getTime() < Date.now() - 6 * 3600_000) {
    const nextDay = new Date(Date.UTC(year, month - 1, day) + 24 * 3600_000);
    const ymd = helsinkiYmd(nextDay);
    iso = helsinkiDateTimeToIso(ymd.year, ymd.month, ymd.day, hour, minute);
  }
  return iso;
}

/** Normalisoi mahdollisesti vajaa ISO-merkkijono kelvolliseksi ISO:ksi. */
function normalizeIso(s: string, baseDate: Date): string {
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) {
    // fallback: yrita parsia pelkka aika
    const m = s.match(/(\d{1,2}):(\d{2})/);
    if (m) return combineDateTime(baseDate, parseInt(m[1], 10), parseInt(m[2], 10));
    return new Date().toISOString();
  }
  return d.toISOString();
}

// ---------- CRUD ----------

export async function insertBookings(
  bookings: ParsedBooking[],
  meta: { source: string; raw_text?: string | null },
): Promise<{ ok: boolean; inserted: number; error?: string }> {
  if (bookings.length === 0) return { ok: true, inserted: 0 };
  const rows = bookings.map((b) => ({
    tolppa: b.tolppa.trim().slice(0, 100),
    pickup_at: b.pickup_at,
    source: meta.source,
    raw_text: meta.raw_text ?? null,
    ocr_confidence: b.confidence ?? null,
    scanned_by_device:
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 100) : null,
  }));
  const { error } = await supabase.from("pre_bookings").insert(rows);
  if (error) return { ok: false, inserted: 0, error: error.message };
  return { ok: true, inserted: rows.length };
}

/** Hae tulevat ennakot (pickup_at >= nyt - bufferMin). */
export async function listUpcomingBookings(bufferMin = 15): Promise<PreBooking[]> {
  const cutoff = new Date(Date.now() - bufferMin * 60_000).toISOString();
  const { data, error } = await supabase
    .from("pre_bookings")
    .select("*")
    .gte("pickup_at", cutoff)
    .order("pickup_at", { ascending: true })
    .limit(200);
  if (error) {
    console.warn("listUpcomingBookings virhe:", error.message);
    return [];
  }
  return (data ?? []) as PreBooking[];
}

/** Hae historiadata (heatmappia varten): N paivaa taaksepain. */
export async function listBookingsHistory(daysBack = 30): Promise<PreBooking[]> {
  const cutoff = new Date(Date.now() - daysBack * 24 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("pre_bookings")
    .select("*")
    .gte("pickup_at", cutoff)
    .order("pickup_at", { ascending: false })
    .limit(2000);
  if (error) return [];
  return (data ?? []) as PreBooking[];
}

export async function deleteBooking(id: string): Promise<boolean> {
  const { error } = await supabase.from("pre_bookings").delete().eq("id", id);
  return !error;
}