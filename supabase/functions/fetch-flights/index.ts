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

const SOURCE_BASE = "https://www.finavia.fi/fi/lentoasemat/helsinki-vantaa/lennot";
const WINDOW_MS = 3 * 60 * 60 * 1000;
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
  // Finavian saapuvien sivulla jokainen lento on monirivinen lohko, esim:
  //   14:40
  //   Vaasa
  //   AY314, JL6874, AS7694
  //   Laskeutunut 14:51   tai   Arvioitu aika 16:08   tai   Peruttu
  //   Tiedot
  //
  // Käytetään "Tiedot"-riviä lohkojen erottimena ja kelataan taaksepäin.

  const lines = md.split("\n").map((l) => l.trim());
  const flights: RawFlight[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "Tiedot") continue;

    // Kerää enintään 6 edellistä ei-tyhjää riviä
    const block: string[] = [];
    for (let j = i - 1; j >= 0 && block.length < 6; j--) {
      if (!lines[j]) continue;
      // Pysähdy heti kun törmätään toiseen "Tiedot" tai otsikkoon
      if (lines[j] === "Tiedot") break;
      if (lines[j].startsWith("#") || lines[j].startsWith("|")) break;
      block.unshift(lines[j]);
    }
    if (block.length < 3) continue;

    // 1. rivi: scheduled HH:MM
    const schedMatch = block[0].match(/^(\d{1,2}):(\d{2})$/);
    if (!schedMatch) continue;
    const scheduled = `${schedMatch[1].padStart(2, "0")}:${schedMatch[2]}`;

    // Etsi loput: origin = ensimmäinen rivi joka EI ole aika, EI lentonumero, EI status
    // Lentonumero-rivi: alkaa 2-3 isolla kirjaimella + numeroilla
    const flightLineRe = /^[A-Z]{1,3}\d+[A-Z]?(?:\s*,\s*[A-Z]{1,3}\d+[A-Z]?)*$/;
    const isStatus = (s: string) =>
      /laskeutu|peru|arvioitu|viivä|odotett|saapunut|lähtenyt|portt|kutsu|saapumas|saapuu/i.test(s);

    let origin = "";
    let flightNumbersLine = "";
    let statusLine = "";

    for (let k = 1; k < block.length; k++) {
      const row = block[k];
      if (/^\d{1,2}:\d{2}$/.test(row)) continue;
      if (flightLineRe.test(row)) { flightNumbersLine = row; continue; }
      if (isStatus(row)) { statusLine = row; continue; }
      if (!origin && /[a-zA-ZäöåÄÖÅ]{3,}/.test(row) && row.length < 60) {
        origin = row;
      }
    }
    if (!origin || !flightNumbersLine) continue;

    const flightNumber = flightNumbersLine.split(",")[0].trim();

    // Tulkitse status ja arvioitu aika
    let status = "Aikataulussa";
    let estimated: string | undefined;
    if (statusLine) {
      const lower = statusLine.toLowerCase();
      const timeMatch = statusLine.match(/(\d{1,2}):(\d{2})/);
      if (lower.includes("laskeutu")) {
        status = "Laskeutunut";
        if (timeMatch) estimated = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
      } else if (lower.includes("peru")) {
        status = "Peruttu";
      } else if (lower.includes("arvioitu") || lower.includes("viivä")) {
        status = "Arvioitu";
        if (timeMatch) estimated = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
      } else {
        status = statusLine;
      }
    }

    flights.push({
      flightNumber,
      origin,
      scheduled,
      estimated: estimated ?? scheduled,
      status,
    });
  }

  return flights;
}

function helsinkiDateString(now: Date): string {
  // Palauttaa YYYY-MM-DD Helsingin aikavyöhykkeellä
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: HELSINKI_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(now);
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

    const todayHel = helsinkiDateString(new Date());
    const sourceUrl = `${SOURCE_BASE}?tab=arr&date=${todayHel}`;
    console.log(`Scrape URL: ${sourceUrl}`);

    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: sourceUrl,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
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
    let droppedPast = 0, droppedFuture = 0, droppedStatus = 0, droppedParse = 0;

    for (const f of raw) {
      const schedDate = parseHelsinkiTime(f.scheduled, now);
      const estDate = f.estimated ? parseHelsinkiTime(f.estimated, now) : schedDate;
      if (!schedDate || !estDate) { droppedParse++; continue; }

      const arrivalMs = estDate.getTime();
      if (arrivalMs < now.getTime() - 15 * 60 * 1000) { droppedPast++; continue; }
      if (arrivalMs > cutoff) { droppedFuture++; continue; }
      if (f.status === "Laskeutunut" || f.status === "Peruttu") { droppedStatus++; continue; }

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

    console.log(`Suodatus: ${flights.length} pidetty, dropped past=${droppedPast} future=${droppedFuture} status=${droppedStatus} parse=${droppedParse}`);
    if (raw.length > 0 && flights.length === 0) {
      console.log("Sample raw:", JSON.stringify(raw.slice(0, 3)));
      console.log("now=", now.toISOString(), "cutoff=", new Date(cutoff).toISOString());
      const sample = parseHelsinkiTime(raw[0].scheduled, now);
      console.log("Esim parsed scheduled:", raw[0].scheduled, "->", sample?.toISOString());
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