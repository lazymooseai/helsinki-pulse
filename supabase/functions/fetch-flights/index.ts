/**
 * fetch-flights
 *
 * Hakee Helsinki-Vantaan (HEL) saapuvat lennot Finavia API:sta.
 * Suodattaa: vain seuraavat 2 tuntia, vain saapuvat (ei lähtevät).
 *
 * Finavia Flights API (apiportal.finavia.fi - Public flights):
 *   GET https://apigw.finavia.fi/flights/public/v0/flights/arr/HEL
 *   Header: app_key: <FINAVIA_API_KEY>
 *   Response: application/xml
 *
 * Caching: 60s muistissa kustannusten minimoimiseksi.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FINAVIA_URL = "https://apigw.finavia.fi/flights/public/v0/flights/arr/HEL";
const WINDOW_MS = 2 * 60 * 60 * 1000; // 2h ikkuna
const HELSINKI_TIMEZONE = "Europe/Helsinki";

let cache: { data: unknown; expires: number } | null = null;
const CACHE_TTL_MS = 15 * 1000;

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

const LONG_HAUL_CODES = new Set([
  "JFK", "LAX", "ORD", "MIA", "DFW", "ATL", "BOS", "EWR", "SFO", "YYZ", "YUL",
  "NRT", "HND", "ICN", "PEK", "PVG", "HKG", "BKK", "SIN", "DEL", "BOM",
  "DXB", "DOH", "AUH", "RUH", "TLV",
  "JNB", "CAI", "ADD",
  "GRU", "EZE", "BOG",
  "SYD", "MEL", "AKL",
]);

const MAJOR_EU_HUBS = new Set([
  "LHR", "CDG", "FRA", "AMS", "MAD", "FCO", "MUC", "ZRH", "VIE", "CPH",
  "ARN", "OSL", "BRU", "DUB", "WAW", "IST",
]);

function classifyDemand(
  origin: string,
  delayMin: number,
  hour: number
): { tag: string; level: "red" | "amber" | "green" } {
  if (LONG_HAUL_CODES.has(origin)) return { tag: "KAUKOLENTO", level: "red" };
  if (delayMin >= 30) return { tag: "VIIVE +30min", level: "red" };
  if (MAJOR_EU_HUBS.has(origin) && (hour >= 16 || hour <= 9)) {
    return { tag: "RUSH HUB", level: "red" };
  }
  if (MAJOR_EU_HUBS.has(origin)) return { tag: "EU-HUB", level: "amber" };
  if (delayMin >= 10) return { tag: `+${delayMin} min`, level: "amber" };
  return { tag: "AIKATAULUSSA", level: "green" };
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HELSINKI_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function getHelsinkiHour(iso?: string): number {
  if (!iso) return 0;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HELSINKI_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
}

function diffMinutes(scheduled?: string, actual?: string): number {
  if (!scheduled || !actual) return 0;
  const s = new Date(scheduled).getTime();
  const a = new Date(actual).getTime();
  if (isNaN(s) || isNaN(a)) return 0;
  return Math.round((a - s) / 60000);
}

/**
 * Erittäin yksinkertainen XML -> tag-objekti -parseri Finavia <flight>-elementeille.
 * Finavian skeema on litteä: jokainen flight sisältää vain teksti-kenttiä.
 */
function parseFlightsXml(xml: string): Record<string, string>[] {
  const flights: Record<string, string>[] = [];
  // Etsi kaikki <flight>...</flight> -lohkot
  const flightRegex = /<flight\b[^>]*>([\s\S]*?)<\/flight>/gi;
  let match: RegExpExecArray | null;
  while ((match = flightRegex.exec(xml)) !== null) {
    const inner = match[1];
    const obj: Record<string, string> = {};
    // Sisältä: <fieldname>value</fieldname>
    const fieldRegex = /<([a-zA-Z0-9_]+)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let f: RegExpExecArray | null;
    while ((f = fieldRegex.exec(inner)) !== null) {
      const tag = f[1];
      const raw = f[2].trim();
      // Pura CDATA jos on
      const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
      obj[tag] = cdata ? cdata[1].trim() : raw;
    }
    flights.push(obj);
  }
  return flights;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("FINAVIA_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "FINAVIA_API_KEY puuttuu" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (cache && cache.expires > Date.now()) {
      return new Response(JSON.stringify(cache.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }

    const r = await fetch(FINAVIA_URL, {
      headers: {
        app_key: apiKey,
        "Cache-Control": "no-cache",
        Accept: "application/xml",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) {
      const body = await r.text();
      console.error(`Finavia ${r.status}:`, body.slice(0, 300));
      return new Response(
        JSON.stringify({
          flights: [],
          count: 0,
          source: "Finavia API",
          error: `Finavia palautti ${r.status}`,
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const xml = await r.text();
    const list = parseFlightsXml(xml);
    console.log(`Finavia: parseroitu ${list.length} lentoa`);

    if (list.length > 0) {
      console.log("Esimerkkilento (raakakentat):", JSON.stringify(list[0]));
    }

    const now = Date.now();
    const cutoff = now + WINDOW_MS;
    const flights: FlightOut[] = [];

    for (const f of list) {
      // Finavia public/v0 -skeemassa kentat:
      //   sdt   = scheduled date/time (aikataulu)
      //   pest_d / est_d = predicted/estimated saapumisaika
      //   act_d = todellinen saapuminen
      //   prm   = statuskoodi (LAN, EXP, SCH, DEP, CXX...)
      //   prt   = statusteksti englanniksi ("Landed", "Expected", "Scheduled")
      //   route_1, route_n_fi_1 = origin (IATA + nimi)
      //   bltarea = matkatavarahihna
      const sched = f.sdt;
      const estimated = f.pest_d || f.est_d || f.act_d || sched;
      if (!sched) continue;

      const arrivalMs = new Date(estimated).getTime();
      if (isNaN(arrivalMs)) continue;
      // Vain seuraavat 2h, sallitaan -15min jo myöhässä olevat
      if (arrivalMs < now - 15 * 60 * 1000 || arrivalMs > cutoff) continue;

      // Ohita peruutetut ja jo laskeutuneet
      const status = (f.prm || "").toUpperCase();
      const statusFi = (f.prt_f || "").toLowerCase();
      if (status === "CXX" || status === "X" || status === "LAN") continue;
      if (statusFi.includes("peruttu") || statusFi.includes("laskeutunut")) continue;

      const delay = diffMinutes(sched, estimated);
      const hour = getHelsinkiHour(estimated);
      const originCode = f.route_1 || f.route1 || "";
      const originName = f.route_n_fi_1 || f.route_n_1 || originCode || "Tuntematon";

      const { tag, level } = classifyDemand(originCode, delay, hour);

      flights.push({
        id: `${f.fltnr || "fl"}-${sched}`,
        flightNumber: f.fltnr || "—",
        airline: f.airline_long || f.airline || "—",
        origin: originName,
        originCode,
        scheduledTime: fmtTime(sched),
        estimatedTime: fmtTime(estimated),
        delayMinutes: delay,
        terminal: f.termid || f.terminal,
        gate: f.gate,
        belt: f.bltarea || f.belt,
        status: f.prt_f || f.prt || "",
        demandTag: tag,
        demandLevel: level,
      });
    }

    console.log(`Finavia: 2h ikkunassa ${flights.length}/${list.length} lentoa`);

    flights.sort((a, b) => {
      if (a.demandLevel === "red" && b.demandLevel !== "red") return -1;
      if (b.demandLevel === "red" && a.demandLevel !== "red") return 1;
      return a.estimatedTime.localeCompare(b.estimatedTime);
    });


    const payload = {
      flights,
      count: flights.length,
      source: "Finavia API",
      timestamp: new Date().toISOString(),
    };

    cache = { data: payload, expires: Date.now() + CACHE_TTL_MS };

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fetch-flights virhe:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
