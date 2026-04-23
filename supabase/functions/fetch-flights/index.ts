/**
 * fetch-flights
 *
 * Hakee Helsinki-Vantaan (HEL) saapuvat lennot scrapaten
 * Finavian julkista saapumistaulua Firecrawlin kautta.
 *
 * Ei vaadi Finavia API -avainta — käyttää FIRECRAWL_API_KEY (managed connection).
 *
 * Suodattaa: vain seuraavat 2 tuntia.
 * Cache: 60s muistissa (scrape-kustannus + nopeus).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOURCE_URL = "https://www.finavia.fi/fi/lentoasemat/helsinki-vantaa/saapuvat-lennot";
const WINDOW_MS = 2 * 60 * 60 * 1000;
const HELSINKI_TIMEZONE = "Europe/Helsinki";
const CACHE_TTL_MS = 60 * 1000;

let cache: { data: unknown; expires: number } | null = null;

interface FlightOut {
  id: string;
  flightNumber: string;
  airline: string;
  origin: string;
  originCode: string;
  scheduledTime: string;
  estimatedTime: string;
  delayMinutes: number;
  terminal?: string;
  gate?: string;
  belt?: string;
  status: string;
  demandTag: string;
  demandLevel: "red" | "amber" | "green";
}

const LONG_HAUL_CITIES = new Set([
  "new york", "newark", "los angeles", "chicago", "miami", "dallas", "atlanta", "boston",
  "san francisco", "toronto", "montreal",
  "tokyo", "tokio", "osaka", "seoul", "soul", "beijing", "peking", "shanghai", "hong kong",
  "bangkok", "singapore", "delhi", "mumbai",
  "dubai", "doha", "abu dhabi", "riyadh", "tel aviv",
  "johannesburg", "cairo", "addis ababa",
  "são paulo", "sao paulo", "buenos aires", "bogotá", "bogota",
  "sydney", "melbourne", "auckland",
]);

const MAJOR_EU_HUBS = new Set([
  "london", "lontoo", "paris", "pariisi", "frankfurt", "amsterdam", "madrid", "rome", "rooma",
  "munich", "münchen", "zurich", "zürich", "vienna", "wien", "copenhagen", "kööpenhamina",
  "stockholm", "tukholma", "oslo", "brussels", "bryssel", "dublin", "warsaw", "varsova", "istanbul",
]);

function classifyDemand(
  originLower: string,
  delayMin: number,
  hour: number,
): { tag: string; level: "red" | "amber" | "green" } {
  const isLong = [...LONG_HAUL_CITIES].some((c) => originLower.includes(c));
  if (isLong) return { tag: "KAUKOLENTO", level: "red" };
  if (delayMin >= 30) return { tag: "VIIVE +30min", level: "red" };
  const isHub = [...MAJOR_EU_HUBS].some((c) => originLower.includes(c));
  if (isHub && (hour >= 16 || hour <= 9)) return { tag: "RUSH HUB", level: "red" };
  if (isHub) return { tag: "EU-HUB", level: "amber" };
  if (delayMin >= 10) return { tag: `+${delayMin} min`, level: "amber" };
  return { tag: "AIKATAULUSSA", level: "green" };
}

function getHelsinkiHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HELSINKI_TIMEZONE, hour: "2-digit", hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

function fmtTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HELSINKI_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

/** Yhdistä HH:MM tämän päivän Helsinki-päivämäärään. Käsittelee yön ylityksen. */
function parseHelsinkiTime(hhmm: string, now: Date): Date | null {
  const m = hhmm.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;

  // Hae nykyinen Helsinki-päivä
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: HELSINKI_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const today = fmt.format(now); // YYYY-MM-DD

  const utcMs = Date.UTC(
    Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)),
    hour, minute, 0,
  );
  // Helsingin offset (kesä +3, talvi +2)
  const probe = new Date(utcMs);
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: HELSINKI_TIMEZONE, timeZoneName: "shortOffset",
  }).formatToParts(probe);
  const tzName = offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
  const offsetMatch = tzName.match(/GMT([+-])(\d+)/);
  const offsetHours = offsetMatch ? (offsetMatch[1] === "+" ? 1 : -1) * Number(offsetMatch[2]) : 2;
  let result = new Date(utcMs - offsetHours * 60 * 60 * 1000);

  // Jos aika on yli 6h menneisyydessä, oletetaan että se on huomenna
  if (result.getTime() < now.getTime() - 6 * 60 * 60 * 1000) {
    result = new Date(result.getTime() + 24 * 60 * 60 * 1000);
  }
  return result;
}

/** Parsi markdown-taulukko lentolistaksi. Yritetään tukea useita formaatteja. */
interface RawFlight {
  flightNumber: string;
  origin: string;
  scheduled: string; // HH:MM
  estimated?: string;
  status?: string;
  gate?: string;
  terminal?: string;
  belt?: string;
}

function parseMarkdownFlights(md: string): RawFlight[] {
  const flights: RawFlight[] = [];
  const lines = md.split("\n");

  // Etsi rivit muotoa: "AY1234 Helsinki–Lontoo 14:25 14:30 Aikataulussa T2 G24"
  // Tai markdown-taulukko: | AY1234 | Lontoo | 14:25 | 14:30 | ... |

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Lentonumero: 2-3 kirjainta + 1-4 numeroa
    const flightMatch = line.match(/\b([A-Z]{2,3}\d{1,4}[A-Z]?)\b/);
    if (!flightMatch) continue;
    const flightNumber = flightMatch[1];

    // Etsi kaikki HH:MM tai HH.MM ajat rivillä
    const times = [...line.matchAll(/\b(\d{1,2}[:.]\d{2})\b/g)].map((m) => m[1]);
    if (times.length === 0) continue;

    // Pilko taulukon solut tai välilyönnit
    const cells = line.includes("|")
      ? line.split("|").map((c) => c.trim()).filter(Boolean)
      : line.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);

    // Yritä löytää lähtökaupunki: ei-numeerinen, ei-aika, ei lentonumero
    let origin = "";
    for (const c of cells) {
      if (c === flightNumber) continue;
      if (/^\d{1,2}[:.]\d{2}$/.test(c)) continue;
      if (/^[A-Z]{2,3}\d{1,4}/.test(c)) continue;
      // Sopiva origin: sisältää aakkosia, yli 2 merkkiä
      if (/[a-zA-ZäöåÄÖÅ]{3,}/.test(c) && c.length < 60) {
        origin = c.replace(/^.*?[–\-]\s*/, "").trim(); // poista "Helsinki–" prefix
        break;
      }
    }
    if (!origin) continue;

    // Etsi status (avainsanoja)
    const lowerLine = line.toLowerCase();
    let status = "Aikataulussa";
    if (lowerLine.includes("laskeutu")) status = "Laskeutunut";
    else if (lowerLine.includes("perut")) status = "Peruttu";
    else if (lowerLine.includes("viiväs") || lowerLine.includes("delayed")) status = "Viivästynyt";
    else if (lowerLine.includes("expected") || lowerLine.includes("odotett")) status = "Odotettu";

    // Terminaali (T1/T2)
    const termMatch = line.match(/\bT([12])\b/);
    // Hihna (esim. 5A, 12)
    const beltMatch = line.match(/\b(?:hihna|belt)[\s:]*([0-9]+[A-Z]?)/i);

    flights.push({
      flightNumber,
      origin,
      scheduled: times[0],
      estimated: times[1],
      status,
      terminal: termMatch ? `T${termMatch[1]}` : undefined,
      belt: beltMatch ? beltMatch[1] : undefined,
    });
  }

  return flights;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          flights: [],
          count: 0,
          source: "Firecrawl",
          error: "FIRECRAWL_API_KEY puuttuu — yhdistä Firecrawl-konnektori",
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (cache && cache.expires > Date.now()) {
      return new Response(JSON.stringify(cache.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }

    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: SOURCE_URL,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 2000,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!r.ok) {
      const body = await r.text();
      console.error(`Firecrawl ${r.status}:`, body.slice(0, 300));
      return new Response(
        JSON.stringify({
          flights: [],
          count: 0,
          source: "Firecrawl",
          error: `Firecrawl palautti ${r.status}`,
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await r.json();
    const md: string = json?.data?.markdown ?? json?.markdown ?? "";
    if (!md) {
      console.error("Firecrawl: tyhjä markdown");
      return new Response(
        JSON.stringify({
          flights: [], count: 0, source: "Firecrawl",
          error: "Tyhjä vastaus Finavian sivulta",
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const raw = parseMarkdownFlights(md);
    console.log(`Parseroitu ${raw.length} lentoa markdownista`);

    const now = new Date();
    const cutoff = now.getTime() + WINDOW_MS;
    const flights: FlightOut[] = [];

    for (const f of raw) {
      const schedDate = parseHelsinkiTime(f.scheduled, now);
      const estDate = f.estimated ? parseHelsinkiTime(f.estimated, now) : schedDate;
      if (!schedDate || !estDate) continue;

      const arrivalMs = estDate.getTime();
      if (arrivalMs < now.getTime() - 15 * 60 * 1000 || arrivalMs > cutoff) continue;
      if (f.status === "Laskeutunut" || f.status === "Peruttu") continue;

      const delay = Math.round((estDate.getTime() - schedDate.getTime()) / 60000);
      const hour = getHelsinkiHour(estDate);
      const originLower = f.origin.toLowerCase();
      const { tag, level } = classifyDemand(originLower, delay, hour);

      flights.push({
        id: `${f.flightNumber}-${f.scheduled}`,
        flightNumber: f.flightNumber,
        airline: f.flightNumber.slice(0, 2), // IATA-koodi prefiksinä
        origin: f.origin,
        originCode: "",
        scheduledTime: fmtTime(schedDate),
        estimatedTime: fmtTime(estDate),
        delayMinutes: delay,
        terminal: f.terminal,
        gate: f.gate,
        belt: f.belt,
        status: f.status ?? "",
        demandTag: tag,
        demandLevel: level,
      });
    }

    flights.sort((a, b) => {
      if (a.demandLevel === "red" && b.demandLevel !== "red") return -1;
      if (b.demandLevel === "red" && a.demandLevel !== "red") return 1;
      return a.estimatedTime.localeCompare(b.estimatedTime);
    });

    const payload = {
      flights,
      count: flights.length,
      source: "Finavia (scrape)",
      timestamp: new Date().toISOString(),
    };

    cache = { data: payload, expires: Date.now() + CACHE_TTL_MS };

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fetch-flights virhe:", msg);
    return new Response(JSON.stringify({
      flights: [], count: 0, source: "Firecrawl", error: msg,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});