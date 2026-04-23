/**
 * eventCategories.ts
 *
 * Yhdistetty aikajananakyma datalahteille: kategorisoi tapahtumat
 * neljaan kategoriaan kuljettajan kannalta:
 *   - asemat   : lennot, kaukojunat, laivat (saapumiset)
 *   - kulttuuri: ooppera, teatterit, konsertit, festivaalit
 *   - urheilu  : Liiga, jalkapallo, NHL, areenat
 *   - muut     : kaikki muu (messut, klubit, manuaaliset overridet)
 *
 * Yhdistaa myos eri datalahteet yhteen TimelineItem-tyyppiin jotta
 * UI voi renderoida ne samalla tavalla 4h aikajanaan.
 */

import type {
  EventInfo,
  FlightArrival,
  ShipArrival,
  TrainDelay,
  SportsEvent,
} from "./types";

export type EventCategory = "asemat" | "kulttuuri" | "urheilu" | "muut";

export interface TimelineItem {
  id: string;
  category: EventCategory;
  /** Kuljettajalle nakyva paaotsikko, esim. "AY1234 Tukholma" */
  title: string;
  /** Paikan nimi tai lisatieto */
  subtitle: string;
  /** Kellonaika HH:MM (alkamis- tai saapumisaika) */
  time: string;
  /** Aika millisekunteina kunnes tapahtuma alkaa/saapuu (negatiivinen = jo kaynnissa) */
  startMs: number;
  level: "red" | "amber" | "green";
  /** Numeerinen "kysynta" pisteytysta varten - max 5/tab valintaan */
  weight: number;
  /** Vapaaehtoinen paatag, esim. "LOPPUUNMYYTY" */
  tag?: string;
  /** Kapasiteetti tai matkustajamaara, jos tiedossa */
  capacity?: number;
  /** Alkuperainen objekti, jotta detail-paneeli toimii */
  raw: { kind: "flight" | "train" | "ship" | "event" | "sports"; data: unknown };
}

// ---------------------------------------------------------------------------
// Venue -> kategoria mappaus (kulttuuri vs urheilu vs muut)
// ---------------------------------------------------------------------------

const URHEILU_KEYS = [
  "stadion",
  "olympiastadion",
  "jaahalli",
  "jäähalli",
  "nordis",
  "veikkausarena",
  "helsinki halli",
  "hartwall",
  "bolt arena",
  "kisahalli",
  "areena",
  "arena",
  "telia 5g",
  "sonera",
  "energia areena",
];

const KULTTUURI_KEYS = [
  "ooppera",
  "kansallisooppera",
  "musiikkitalo",
  "teatteri",
  "kaupunginteatteri",
  "kansallisteatteri",
  "tanssin talo",
  "savoy",
  "kannusali",
  "finlandia",
  "kulttuuritalo",
  "tavastia",
  "korjaamo",
  "g livelab",
  "musiikkitalo",
  "alexanderinteatteri",
  "kallio-kuninkala",
];

/** Luokittelee venuen sanan perusteella. Muut on default. */
export function categorizeVenue(venue: string): EventCategory {
  const v = venue.toLowerCase();
  if (URHEILU_KEYS.some((k) => v.includes(k))) return "urheilu";
  if (KULTTUURI_KEYS.some((k) => v.includes(k))) return "kulttuuri";
  return "muut";
}

// ---------------------------------------------------------------------------
// Aika-apurit
// ---------------------------------------------------------------------------

/** Parsii "HH:MM" tai ISO -ajan ja palauttaa millisekunnit nyt-hetkeen verrattuna */
function timeToMs(timeStr: string): number {
  if (!timeStr) return 0;
  // ISO-aika
  if (timeStr.includes("T") || timeStr.includes("-")) {
    const t = new Date(timeStr).getTime();
    return t - Date.now();
  }
  // HH:MM (oletetaan tanaan)
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  // Jos aika on jo mennyt yli 30 min sitten -> oletetaan huomenna (esim. lentoasemille klo 00:30)
  if (d.getTime() < Date.now() - 30 * 60 * 1000) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime() - Date.now();
}

/** Onko kohde aika-ikkunan sisalla? maxMin = paljonko eteenpain, minMin = miten paljon ohi voi olla (oletus -30min) */
export function inWindow(item: TimelineItem, maxMinutes: number, minMinutes = -30): boolean {
  const minutes = item.startMs / 60000;
  return minutes >= minMinutes && minutes <= maxMinutes;
}

// ---------------------------------------------------------------------------
// Adapterit: dataformaatit -> TimelineItem
// ---------------------------------------------------------------------------

export function eventToTimelineItem(e: EventInfo): TimelineItem {
  const time = e.startTime ?? "";
  const startMs = timeToMs(time);
  const level = e.demandLevel || (e.soldOut ? "red" : "amber");
  // Painotus: red = 100, amber = 50, capacity bonus
  const weight =
    (level === "red" ? 100 : level === "amber" ? 50 : 10) +
    (e.capacity ? Math.min(50, e.capacity / 100) : 0) +
    (e.soldOut ? 30 : 0);

  return {
    id: `event-${e.id}`,
    category: categorizeVenue(e.venue),
    title: e.name,
    subtitle: e.venue,
    time,
    startMs,
    level,
    weight,
    tag: e.demandTag,
    capacity: e.capacity,
    raw: { kind: "event", data: e },
  };
}

export function flightToTimelineItem(f: FlightArrival): TimelineItem {
  const startMs = timeToMs(f.estimatedTime);
  // Painotus: kaukolennot (intercontinental) painavammat
  const weight =
    (f.demandLevel === "red" ? 100 : f.demandLevel === "amber" ? 50 : 20) +
    (f.delayMinutes > 30 ? 20 : 0);

  return {
    id: `flight-${f.id}`,
    category: "asemat",
    title: `${f.flightNumber} • ${f.origin}`,
    subtitle: `${f.terminal ?? "HEL"}${f.delayMinutes > 0 ? ` • +${f.delayMinutes}min` : ""}`,
    time: f.estimatedTime,
    startMs,
    level: f.demandLevel,
    weight,
    tag: f.demandTag,
    raw: { kind: "flight", data: f },
  };
}

export function shipToTimelineItem(s: ShipArrival): TimelineItem {
  const pax = s.estimatedPax ?? s.pax;
  const startMs = timeToMs(s.eta);
  const level: "red" | "amber" | "green" =
    pax > 2000 ? "red" : pax > 1000 ? "amber" : "green";
  const weight = (level === "red" ? 100 : level === "amber" ? 50 : 20) + Math.min(50, pax / 50);

  return {
    id: `ship-${s.id}`,
    category: "asemat",
    title: s.ship,
    subtitle: `${s.harbor} • ~${pax.toLocaleString("fi-FI")} hlö`,
    time: s.eta,
    startMs,
    level,
    weight,
    capacity: s.pax,
    raw: { kind: "ship", data: s },
  };
}

export function trainToTimelineItem(t: TrainDelay, stationName: string): TimelineItem {
  const startMs = timeToMs(t.arrivalTime);
  const level: "red" | "amber" | "green" =
    t.delayMinutes > 60 ? "red" : t.delayMinutes > 10 ? "amber" : "green";
  // Junat painavammat jos myohassa, koska aiheuttaa ruuhkaa
  const weight = (level === "red" ? 80 : level === "amber" ? 40 : 15) + Math.min(20, t.delayMinutes);

  return {
    id: `train-${t.id}`,
    category: "asemat",
    title: `${t.line} ${t.origin}`,
    subtitle: `→ ${stationName}${t.delayMinutes > 0 ? ` • +${t.delayMinutes}min` : ""}`,
    time: t.arrivalTime,
    startMs,
    level,
    weight,
    raw: { kind: "train", data: t },
  };
}

export function sportsToTimelineItem(s: SportsEvent): TimelineItem {
  const startMs = timeToMs(s.startTime);
  const weight =
    (s.demandLevel === "red" ? 100 : s.demandLevel === "amber" ? 50 : 20) +
    Math.min(50, s.expectedAttendance / 200);

  return {
    id: `sports-${s.id}`,
    category: "urheilu",
    title: `${s.homeTeam} – ${s.awayTeam}`,
    subtitle: `${s.venue} • ~${s.expectedAttendance.toLocaleString("fi-FI")} hlö`,
    time: s.startTime,
    startMs,
    level: s.demandLevel,
    weight,
    tag: s.demandTag,
    capacity: s.capacity,
    raw: { kind: "sports", data: s },
  };
}

// ---------------------------------------------------------------------------
// Kategoria-metadata UI:lle
// ---------------------------------------------------------------------------

export const CATEGORY_ORDER: EventCategory[] = ["asemat", "kulttuuri", "urheilu", "muut"];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  asemat: "Asemat",
  kulttuuri: "Kulttuuri",
  urheilu: "Urheilu",
  muut: "Muut",
};
