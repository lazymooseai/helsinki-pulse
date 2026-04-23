/**
 * events.ts
 *
 * Tapahtumadatan haku Lovable Cloud -tietokannasta.
 * Tapahtumat skrapataan venue-sivuilta (oopperabaletti.fi, helsinginjaahalli.fi, jne.)
 * scrape-events edge functionilla 2h välein + manuaaliset overridet kuljettajilta.
 *
 * - fetchEventsFromDB: hakee 7 pv ikkunan tapahtumat
 * - getFallbackEvents: vain hätävara kun DB tyhjä
 */

import { EventInfo } from "./types";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Apufunktiot
// ---------------------------------------------------------------------------

function formatTime(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

function endsInMinutes(endIso?: string | null, startIso?: string | null): number {
  const end = endIso ? new Date(endIso).getTime() : startIso ? new Date(startIso).getTime() + 2.5 * 60 * 60 * 1000 : Date.now();
  return Math.max(0, Math.round((end - Date.now()) / 60000));
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isCurrentlyActive(startIso: string, endIso?: string | null): boolean {
  const now = Date.now();
  const s = new Date(startIso).getTime();
  const e = endIso ? new Date(endIso).getTime() : s + 3 * 60 * 60 * 1000;
  // Naytetaan 4h ennen alkua jos tanaan, ja kunnes loppuu
  return now >= s - 4 * 60 * 60 * 1000 && now <= e;
}

function getDemandTagFromLevel(level: string, soldOut: boolean): string {
  if (soldOut) return "LOPPUUNMYYTY";
  if (level === "red") return "KORKEA KYSYNTÄ";
  if (level === "amber") return "PREMIUM";
  return "NORMAALI";
}

interface DbEventRow {
  id: string;
  name: string;
  venue: string;
  start_time: string;
  end_time: string | null;
  capacity: number | null;
  tickets_sold: number | null;
  load_factor: number | null;
  sold_out: boolean;
  demand_level: string;
  demand_tag: string | null;
  source: string;
  is_manual: boolean;
  availability_note?: string | null;
}

function rowToEvent(row: DbEventRow): EventInfo {
  const attendance = row.tickets_sold ?? (row.load_factor && row.capacity
    ? Math.round(row.capacity * Number(row.load_factor))
    : undefined);

  const level = (row.demand_level as "red" | "amber" | "green") || "amber";

  return {
    id: row.id,
    name: row.name,
    venue: row.venue,
    endsIn: endsInMinutes(row.end_time, row.start_time),
    soldOut: row.sold_out,
    demandTag: row.demand_tag || getDemandTagFromLevel(level, row.sold_out),
    demandLevel: level,
    startTime: formatTime(row.start_time),
    endTime: formatTime(row.end_time),
    capacity: row.capacity ?? undefined,
    estimatedAttendance: attendance,
    loadFactor: row.load_factor != null ? Number(row.load_factor) : undefined,
    availabilityNote: row.availability_note ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EventsBundle {
  today: EventInfo[];
  upcoming: EventInfo[]; // 2-7 paivan tapahtumat
}

/**
 * Hakee 7 pv ikkunan tapahtumat tietokannasta, jaettuna tanaan / tulevat.
 */
export async function fetchEventsBundle(): Promise<EventsBundle> {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const sevenDaysOut = new Date(now);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  sevenDaysOut.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gte("start_time", start.toISOString())
    .lte("start_time", sevenDaysOut.toISOString())
    .order("start_time", { ascending: true });

  if (error) {
    console.warn("fetchEventsBundle DB error:", error.message);
    return { today: [], upcoming: [] };
  }

  const rows = (data as DbEventRow[]) ?? [];
  const today: EventInfo[] = [];
  const upcoming: EventInfo[] = [];

  for (const row of rows) {
    const ev = rowToEvent(row);
    if (isToday(row.start_time) && isCurrentlyActive(row.start_time, row.end_time)) {
      today.push(ev);
    } else if (!isToday(row.start_time) || new Date(row.start_time).getTime() > Date.now()) {
      // Tuleva: ei tanaan TAI tanaan mutta ei viela aktiivinen
      upcoming.push(ev);
    }
  }

  // Lajittele: red ensin, sitten alkamisaika
  const sortFn = (a: EventInfo, b: EventInfo) => {
    if (a.demandLevel === "red" && b.demandLevel !== "red") return -1;
    if (b.demandLevel === "red" && a.demandLevel !== "red") return 1;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  };

  today.sort(sortFn);
  upcoming.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  return { today, upcoming };
}

/** Yhteensopivuus: vanha API palauttaa vain tanaan-listan */
export async function fetchHelsinkiEvents(): Promise<EventInfo[]> {
  const bundle = await fetchEventsBundle();
  return bundle.today;
}

/** Tyhja fallback - tietokanta on totuuden lahde */
export function getFallbackEvents(): EventInfo[] {
  return [];
}

/** Lisaa manuaalinen tapahtuma tietokantaan */
export async function addManualEvent(input: {
  name: string;
  venue: string;
  start_time: string; // ISO
  end_time?: string;  // ISO
  capacity?: number;
  tickets_sold?: number;
  demand_level?: "red" | "amber" | "green";
}): Promise<{ ok: boolean; error?: string }> {
  const load_factor = input.tickets_sold && input.capacity
    ? input.tickets_sold / input.capacity
    : null;
  const demand_level = input.demand_level || (load_factor && load_factor >= 0.9 ? "red" : load_factor && load_factor >= 0.7 ? "amber" : "green");

  const { error } = await supabase.from("events").insert({
    name: input.name,
    venue: input.venue,
    start_time: input.start_time,
    end_time: input.end_time ?? null,
    capacity: input.capacity ?? null,
    tickets_sold: input.tickets_sold ?? null,
    load_factor,
    demand_level,
    sold_out: false,
    source: "manual",
    is_manual: true,
    last_scraped_at: new Date().toISOString(),
  });

  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Poista manuaalinen tapahtuma */
export async function deleteManualEvent(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("events").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Triggeroi venue-skrapauksen kasin */
export async function triggerEventScrape(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("scrape-events");
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Triggeroi lipunmyyntidatan rikastuksen Firecrawlilla */
export async function triggerTicketEnrichment(): Promise<{ ok: boolean; processed?: number; error?: string }> {
  const { data, error } = await supabase.functions.invoke("enrich-event-tickets");
  if (error) return { ok: false, error: error.message };
  return { ok: true, processed: (data as { processed?: number })?.processed ?? 0 };
}
