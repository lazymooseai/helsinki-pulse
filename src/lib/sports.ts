/**
 * sports.ts
 *
 * Urheilutapahtumien haku. Yritys-fallback-ketju:
 *   1. LinkedEvents API urheilukategoriaan suodatettuna (api.hel.fi)
 *   2. Manuaalinen fallback isoille areenoille viikonpäivä/aika-heuristiikalla
 *
 * Joukkuetiedot ja yleisömääräarviot perustuvat:
 *   - HIFK ja Jokerit (jää) → Helsingin Jäähalli, kapasiteetti 8200
 *   - HJK ja HIFK (jalkapallo) → Bolt Arena, kapasiteetti 10770
 *   - Maajoukkueottelut → Olympiastadion, kapasiteetti 36200
 */

import type { SportsEvent } from "./types";

// ---------------------------------------------------------------------------
// Areenoiden kapasiteetit
// ---------------------------------------------------------------------------

const VENUE_CAPACITY: Record<string, number> = {
  "Helsingin Jäähalli": 8200,
  "Helsinki Halli": 13506,
  "Bolt Arena": 10770,
  "Olympiastadion": 36200,
  "Töölön kisahalli": 4500,
};

// Tunnetut joukkueet ja niiden kotihalli
const TEAM_VENUES: Record<string, string> = {
  hifk: "Helsingin Jäähalli",
  jokerit: "Helsinki Halli",
  jukurit: "Helsingin Jäähalli",
  hjk: "Bolt Arena",
  klubi: "Bolt Arena",
};

// ---------------------------------------------------------------------------
// LinkedEvents-haku (urheilu-keyword)
// ---------------------------------------------------------------------------

interface LinkedEvent {
  id: string;
  name?: { fi?: string; en?: string };
  location?: {
    name?: { fi?: string; en?: string };
    street_address?: { fi?: string; en?: string };
  };
  start_time?: string;
  end_time?: string;
  keywords?: Array<{ "@id"?: string; name?: { fi?: string; en?: string } }>;
}

function getName(n?: { fi?: string; en?: string }): string {
  return n?.fi || n?.en || "";
}

function venueFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("nordis") || lower.includes("garden helsinki") || lower.includes("jäähalli") || lower.includes("jaahalli")) {
    return "Helsingin Jäähalli";
  }
  if (lower.includes("helsinki halli") || lower.includes("hartwall")) {
    return "Helsinki Halli";
  }
  if (lower.includes("bolt arena") || lower.includes("töölön jalkapallostadion")) {
    return "Bolt Arena";
  }
  if (lower.includes("olympiastadion") || lower.includes("olympic stadium")) {
    return "Olympiastadion";
  }
  return null;
}

function parseTeams(name: string): { home: string; away: string } | null {
  // Yleisimmät kaaviot: "HIFK – Tappara", "HJK vs FC Inter", "HIFK-Jokerit"
  const sep = /\s*[–\-vs|@]+\s*/i;
  const parts = name.split(sep).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && parts[0].length <= 25 && parts[1].length <= 25) {
    return { home: parts[0], away: parts[1] };
  }
  return null;
}

function attendanceEstimate(venue: string, league: string, weekday: number): number {
  const cap = VENUE_CAPACITY[venue] ?? 5000;
  // Viikonloppu = täydempi
  const isWeekend = weekday === 5 || weekday === 6 || weekday === 0;
  if (league.toLowerCase().includes("liiga") || league.toLowerCase().includes("nhl")) {
    return Math.round(cap * (isWeekend ? 0.85 : 0.7));
  }
  if (league.toLowerCase().includes("veikkausliiga")) {
    return Math.round(cap * (isWeekend ? 0.55 : 0.4));
  }
  if (league.toLowerCase().includes("maa")) {
    return Math.round(cap * 0.9);
  }
  return Math.round(cap * (isWeekend ? 0.6 : 0.45));
}

function demand(attendance: number, capacity: number): { tag: string; level: "red" | "amber" | "green" } {
  const ratio = attendance / capacity;
  if (attendance >= 8000 || ratio >= 0.85) return { tag: "MASSIIVINEN YLEISÖ", level: "red" };
  if (attendance >= 4000 || ratio >= 0.6) return { tag: "KORKEA KYSYNTÄ", level: "red" };
  if (attendance >= 2000) return { tag: "SUURI TAPAHTUMA", level: "amber" };
  return { tag: "NORMAALI", level: "green" };
}

function fmtHHMM(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.getHours().toString().padStart(2, "0") +
    ":" +
    d.getMinutes().toString().padStart(2, "0")
  );
}

function endsInMin(end?: string): number {
  if (!end) return 120;
  return Math.round((new Date(end).getTime() - Date.now()) / 60000);
}

function isActiveTodayOrSoon(start?: string, end?: string): boolean {
  if (!start) return false;
  const now = Date.now();
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : s + 3 * 60 * 60 * 1000;
  // Aktiivinen 4h ennen alkua → loppuun asti
  return now >= s - 4 * 60 * 60 * 1000 && now <= e;
}

// ---------------------------------------------------------------------------
// Pääfunktio
// ---------------------------------------------------------------------------

export async function fetchSportsEvents(): Promise<SportsEvent[]> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const apiEvents: SportsEvent[] = [];

  try {
    const params = new URLSearchParams({
      start: todayStart.toISOString(),
      end: todayEnd.toISOString(),
      include: "location,keywords",
      page_size: "100",
      language: "fi",
      keyword: "yso:p965,yso:p916,yso:p6915", // urheilu, jääkiekko, jalkapallo
    });

    const res = await fetch(
      `https://api.hel.fi/linkedevents/v1/event/?${params}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
    );

    if (res.ok) {
      const json = await res.json();
      const list: LinkedEvent[] = json.data ?? [];

      for (const ev of list) {
        if (!isActiveTodayOrSoon(ev.start_time, ev.end_time)) continue;

        const eventName = getName(ev.name);
        const locText = `${getName(ev.location?.name)} ${getName(ev.location?.street_address)} ${eventName}`;
        const venue = venueFromText(locText);
        if (!venue) continue;

        const teams = parseTeams(eventName);
        if (!teams) continue;

        const cap = VENUE_CAPACITY[venue] ?? 5000;
        const weekday = new Date(ev.start_time!).getDay();
        const league = ev.keywords?.[0]?.name?.fi || "Urheilu";
        const attendance = attendanceEstimate(venue, league, weekday);
        const { tag, level } = demand(attendance, cap);

        apiEvents.push({
          id: ev.id,
          homeTeam: teams.home,
          awayTeam: teams.away,
          venue,
          startTime: fmtHHMM(ev.start_time),
          expectedAttendance: attendance,
          capacity: cap,
          league,
          endsIn: endsInMin(ev.end_time),
          demandTag: tag,
          demandLevel: level,
        });
      }
    }
  } catch (err) {
    console.warn("LinkedEvents urheiluhaku epaonnistui:", err);
  }

  // Jos APIsta löytyi ottelu(ita), palautetaan ne
  if (apiEvents.length > 0) {
    return apiEvents.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // Manuaalinen fallback
  return getFallbackSportsEvents();
}

// ---------------------------------------------------------------------------
// Manuaalinen fallback — viikonpäivä-heuristiikka
// ---------------------------------------------------------------------------

/**
 * Manuaalinen fallback — POISTETTU.
 *
 * Aiempi viikonpäivä-heuristiikka näytti virheellisesti otteluita silloinkin
 * kun areenalla oli konsertti tai muu tapahtuma. Reaaliaikaisuuden takaamiseksi
 * palautetaan tyhjä lista, jolloin Suositusalue-kortti ohittaa urheilun ja
 * käyttää oikeaa LinkedEvents-dataa (events) tai muuta lähdettä.
 */
export function getFallbackSportsEvents(): SportsEvent[] {
  return [];
}

// Eksportoi joukkuekartoitus muille moduuleille
export { TEAM_VENUES, VENUE_CAPACITY };
