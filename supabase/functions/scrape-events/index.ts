/**
 * scrape-events
 *
 * Skrapaa Helsingin tapahtumapaikkojen sivut Firecrawlilla ja jasentelee
 * Lovable AI:lla strukturoiduksi dataksi. Tallentaa events-tauluun.
 *
 * Ajetaan cron 2h valein. Hakee 7 paivaa eteenpain.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Lähteet:
 *  - stadissa.fi (aggregaattori): kattaa kaikki Helsingin + Espoon tapahtumat
 *    venuen kanssa "Nimi | Venue" -muodossa. Pääasiallinen lista.
 *  - venue-spesifit ohjelmasivut + lipunmyyntisivut: tarkat saatavuudet
 *    isoille venueille (ooppera, jäähalli, stadion, hkt jne.)
 */
const AGGREGATOR_SOURCES = [
  'https://www.stadissa.fi/',
  'https://www.stadissa.fi/?date=tomorrow',
];

// Tunnetut venue-kapasiteetit jotta voidaan laskea load_factor
const VENUE_CAPACITIES: Record<string, number> = {
  'Suomen Kansallisooppera': 1350,
  'Kansallisooppera': 1350,
  'Helsingin Jäähalli': 8200,
  'Jäähalli': 8200,
  'Helsinki Halli': 15500,
  'Veikkaus Arena': 15500,
  'Veikkaus Arena, ent. Hartwall Arena': 15500,
  'Olympiastadion': 36000,
  'Musiikkitalo': 1700,
  'Messukeskus': 12000,
  'Helsingin Kaupunginteatteri': 1120,
  'Suomen Kansallisteatteri': 880,
  'Kansallisteatteri': 880,
  'Tanssin Talo': 700,
  'Savoy-teatteri': 700,
  'Kannusali (Espoon keskus)': 700,
  'Kannusali': 700,
  'Espoon Kulttuurikeskus': 800,
  'Sellosali': 400,
  'Tavastia-klubi': 700,
  'Tavastia': 700,
  'Kulttuuritalo': 1500,
  'KULT, Kulttuuritalo': 1500,
  'Tapiolasali': 700,
  'Finlandia-talo': 1700,
  'Peacock-teatteri': 600,
  'Svenska Teatern': 500,
  'Ääniwalli': 1200,
  'Semifinal': 250,
  'Siltanen': 400,
  'Bar Loose': 300,
  'Kulttuuritehdas Korjaamo': 500,
  'Korjaamo': 500,
  'Töölön Kisahalli': 2500,
  'Kisahalli': 2500,
  'Bolt Arena': 10770,
  'Konepajan näyttämö': 400,
  'Teatteri Jurkka': 120,
  'Opistotalo ja Helsingin työväenopisto': 300,
  'G Livelab': 250,
  'Tiivistämö': 400,
  'Dubrovnik Lounge & Lobby': 600,
};

// Tarkat saatavuussivut (skrapataan saatavuustietojen päivittämiseksi)
const TICKET_SOURCES = [
  { venueMatch: /ooppera/i, url: 'https://shop.oopperabaletti.fi/fi/' },
  { venueMatch: /jäähalli|jaahalli/i, url: 'https://www.lippu.fi/venue/helsingin-jaahalli-helsinki-159/' },
  { venueMatch: /helsinki halli|veikkausarena/i, url: 'https://www.lippu.fi/venue/helsinki-halli-helsinki-1102/' },
  { venueMatch: /olympiastadion/i, url: 'https://www.lippu.fi/venue/olympiastadion-helsinki-188/' },
  { venueMatch: /kaupunginteatteri/i, url: 'https://www.lippu.fi/venue/helsingin-kaupunginteatteri-helsinki-178/' },
  { venueMatch: /kansallisteatteri/i, url: 'https://www.lippu.fi/venue/suomen-kansallisteatteri-helsinki-209/' },
];

interface ParsedEvent {
  name: string;
  start_time: string; // ISO
  end_time?: string;  // ISO
  sold_out?: boolean;
  load_factor?: number; // 0..1
  availability_note?: string;
}

async function firecrawlScrape(url: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 1500,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data?.markdown || data.markdown || '';
}

interface ParsedAggregatorEvent extends ParsedEvent {
  venue: string;
}

/**
 * Parsii stadissa.fi-tyyppisen aggregaattorimarkdownin (Helsinki + Espoo).
 * Palauttaa rivit, joissa on { name, venue, start_time, end_time }.
 * AI:n tehtävä: tunnistaa päivämääräotsikot + tapahtumarivit "HH | nimi | venue".
 */
async function aiParseAggregator(markdown: string, lovableKey: string): Promise<ParsedAggregatorEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const prompt = `Olet tapahtumadatan jäsentelijä. Annetussa markdownissa on Helsingin/Espoon tapahtumakalenteri.
Päivämäärät esitellään otsikoissa kuten "torstai 23 huhtikuu 2026". Niiden alla on tapahtumat muodossa:
  "HH" (aloitustunti)
  "[Tapahtuman nimi](url "Tapahtuman nimi | Venue")"

TEHTÄVÄ: Poimi VAIN tapahtumat aikavälillä ${today} - ${sevenDays} (Europe/Helsinki).

Palauta JSON:
{
  "events": [
    {
      "name": "Tapahtuman nimi (ilman venuea)",
      "venue": "Venue",
      "start_time": "2026-04-23T19:00:00+03:00",
      "end_time": "2026-04-23T21:30:00+03:00"
    }
  ]
}

SÄÄNNÖT:
- Käytä title-attribuutista venuen nimi (osa "| Venue" jälkeen). Jos puuttuu, jätä tyhjäksi.
- start_time = otsikkopäivä + tunti (HH:00). Käytä +03:00 (kesäaika) huhtikuu–lokakuu, +02:00 muulloin.
- end_time = start_time + 2.5h (oletus konsertille/teatterille).
- Skipataan toistuvat näyttelyt, joiden aloitustunti on alle 12 ja jotka kestävät koko päivän (esim. galleriat) — keskity iltatapahtumiin (klo 17+) JA isoihin lounastapahtumiin.
- Ota MUKAAN: konsertit, teatteri, ooppera, urheilu, suuret esitykset, festivaalit. ÄLÄ ota mukaan: pubivisat, baaripelit, päivittäiset bingoiltat, jatkuvat näyttelyt.
- ÄLÄ keksi tapahtumia. Vain markdownissa näkyvät.

MARKDOWN:
${markdown.slice(0, 18000)}`;

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{"events":[]}';
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

async function aiParseEvents(venue: string, markdown: string, lovableKey: string): Promise<ParsedEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const prompt = `Olet tapahtumadatan jäsentelijä. Hae annetusta sivun markdownista TAPAHTUMAT aikavälillä ${today} - ${sevenDays} (Helsingin aika, Europe/Helsinki).
Sivu voi olla joko venue-ohjelmasivu TAI lipunmyyntisivu (esim. lippu.fi, shop.oopperabaletti.fi).

Venue: ${venue}

Palauta JSON-muodossa:
{
  "events": [
    {
      "name": "Tapahtuman nimi",
      "start_time": "2026-04-21T19:00:00+03:00",
      "end_time": "2026-04-21T22:30:00+03:00",
      "sold_out": false,
      "load_factor": 0.85,
      "availability_note": "Vain 12 paikkaa jäljellä" 
    }
  ]
}

Säännöt:
- Vain tapahtumat aikavälillä ${today} - ${sevenDays}
- ISO 8601 + Helsinki-aikavyöhyke (+03:00 kesäaikana, +02:00 talviaikana)
- end_time = start_time + arvioitu kesto venue-tyypin mukaan: konsertti 2.5h, ooppera 2.5h, teatteri 2.5h, messut 8h, urheilu 2.5h. Jos sivu mainitsee keston tai loppuajan, käytä sitä.
- sold_out = true jos sivulla on selkeästi "loppuunmyyty", "sold out", "ei lippuja saatavilla", tai vastaava merkintä
- load_factor TARKKUUSSÄÄNNÖT (lue sivua HUOLELLA):
  * 1.00 jos sold_out = true
  * 0.92-0.98 jos sivu mainitsee "vain N paikkaa jäljellä" (N < 50) tai "viimeiset liput" tai "few left"
  * 0.80-0.90 jos sivu mainitsee "vähän lippuja jäljellä", "low availability", "harvat paikat"
  * 0.60-0.75 jos sivu näyttää useita kategorioita saatavilla mutta jotkin loppu
  * 0.40-0.55 jos kaikki kategoriat näyttävät täysin saatavilla
  * 0.30 jos sivu mainitsee "hyvin lippuja" tai uusi tapahtuma
  * Jos et löydä TARKKAA saatavuustietoa, käytä 0.50 (älä arvaa korkeammalle)
- availability_note: vapaa tekstikenttä jossa kerrotaan mikä sivulla luki saatavuudesta (esim. "Vain 8 paikkaa jäljellä parvella", "Loppuunmyyty"). Tyhjä jos ei mainintaa.
- Jos et löydä tapahtumia, palauta {"events": []}
- ÄLÄ keksi tapahtumia. Vain selkeästi sivulla olevat.
- ÄLÄ arvaa load_factor:ia korkeaksi ilman näyttöä. Jos sivu ei kerro saatavuutta, käytä 0.50.

MARKDOWN:
${markdown.slice(0, 12000)}`;

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{"events":[]}';
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

function pickCapacityForVenue(venue: string): number | null {
  if (!venue) return null;
  const v = venue.trim();
  if (VENUE_CAPACITIES[v] != null) return VENUE_CAPACITIES[v];
  // fuzzy: tarkista osumat
  for (const [key, cap] of Object.entries(VENUE_CAPACITIES)) {
    if (v.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(v.toLowerCase())) {
      return cap;
    }
  }
  return null;
}

function classifyDemand(loadFactor: number | null, soldOut: boolean): { level: 'red' | 'amber' | 'green'; tag: string } {
  if (soldOut) return { level: 'red', tag: 'LOPPUUNMYYTY' };
  const lf = loadFactor ?? 0;
  if (lf >= 0.9) return { level: 'red', tag: 'KORKEA KYSYNTÄ' };
  if (lf >= 0.7) return { level: 'amber', tag: 'PREMIUM' };
  return { level: 'green', tag: 'NORMAALI' };
}

/** Skrapaa yhden aggregaattorisivun ja palauttaa parsedut tapahtumat. */
async function scrapeAggregator(url: string, firecrawlKey: string, lovableKey: string): Promise<ParsedAggregatorEvent[]> {
  const md = await firecrawlScrape(url, firecrawlKey);
  if (!md) return [];
  return aiParseAggregator(md, lovableKey);
}

/** Skrapaa yhden lipunmyyntisivun saatavuuden tarkennusta varten. */
async function scrapeTicketSource(url: string, firecrawlKey: string, lovableKey: string): Promise<ParsedEvent[]> {
  try {
    const md = await firecrawlScrape(url, firecrawlKey);
    if (!md) return [];
    return await aiParseEvents('Lipunmyynti', md, lovableKey);
  } catch (e) {
    console.warn(`Ticket scrape failed (${url}):`, e instanceof Error ? e.message : String(e));
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!FIRECRAWL_API_KEY || !LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing required secrets' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Skrapaa aggregaattorit + lipunmyyntisivut RINNAKKAIN
  const aggregatorPromises = AGGREGATOR_SOURCES.map((u) =>
    scrapeAggregator(u, FIRECRAWL_API_KEY, LOVABLE_API_KEY)
      .then((evs) => ({ url: u, events: evs, error: null as string | null }))
      .catch((e) => ({ url: u, events: [] as ParsedAggregatorEvent[], error: e instanceof Error ? e.message : String(e) }))
  );

  const ticketPromises = TICKET_SOURCES.map((t) =>
    scrapeTicketSource(t.url, FIRECRAWL_API_KEY, LOVABLE_API_KEY)
      .then((evs) => ({ url: t.url, venueMatch: t.venueMatch, events: evs }))
      .catch(() => ({ url: t.url, venueMatch: t.venueMatch, events: [] as ParsedEvent[] }))
  );

  const [aggregatorResults, ticketResults] = await Promise.all([
    Promise.all(aggregatorPromises),
    Promise.all(ticketPromises),
  ]);

  // 2) Yhdistä aggregaattorin tapahtumat (deduplikoidaan: sama venue+start_time+name)
  const combined = new Map<string, ParsedAggregatorEvent>();
  for (const r of aggregatorResults) {
    for (const ev of r.events) {
      if (!ev.start_time || !ev.name) continue;
      const key = `${(ev.venue || 'tuntematon').toLowerCase()}|${ev.start_time.slice(0, 16)}|${ev.name.toLowerCase().slice(0, 40)}`;
      if (!combined.has(key)) combined.set(key, ev);
    }
  }

  // 3) Tarkenna saatavuudet lipunmyyntisivuilta nimi-matchilla
  for (const ev of combined.values()) {
    const ticketSet = ticketResults.find((t) => t.venueMatch.test(ev.venue || ''));
    if (!ticketSet) continue;
    const match = ticketSet.events.find((te) => {
      const a = te.name.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
      const b = ev.name.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
      return a && b && (a.includes(b) || b.includes(a));
    });
    if (match) {
      ev.sold_out = match.sold_out ?? ev.sold_out;
      ev.load_factor = match.load_factor ?? ev.load_factor;
      ev.availability_note = match.availability_note ?? ev.availability_note;
    }
  }

  // 4) Upsert tietokantaan
  let upsertCount = 0;
  const upsertErrors: string[] = [];
  for (const ev of combined.values()) {
    const venueName = ev.venue?.trim() || 'Tuntematon paikka';
    const capacity = pickCapacityForVenue(venueName);
    const tickets_sold = ev.load_factor != null && capacity ? Math.round(capacity * ev.load_factor) : null;
    const { level, tag } = classifyDemand(ev.load_factor ?? null, !!ev.sold_out);
    const externalId = `scraped:${venueName}:${ev.start_time}:${ev.name.slice(0, 50)}`;

    const { error } = await supabase.from('events').upsert({
      external_id: externalId,
      name: ev.name,
      venue: venueName,
      start_time: ev.start_time,
      end_time: ev.end_time ?? null,
      capacity,
      tickets_sold,
      load_factor: ev.load_factor ?? null,
      sold_out: !!ev.sold_out,
      demand_level: level,
      demand_tag: tag,
      source_url: 'https://www.stadissa.fi/',
      source: 'scraper',
      is_manual: false,
      last_scraped_at: new Date().toISOString(),
    }, { onConflict: 'external_id' });

    if (error) {
      upsertErrors.push(`${ev.name}: ${error.message}`);
    } else {
      upsertCount++;
    }
  }

  // 5) Siivoa vanhat skrapatut tapahtumat (eilistä vanhemmat)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('events').delete().eq('source', 'scraper').lt('start_time', cutoff);

  return new Response(JSON.stringify({
    ok: true,
    timestamp: new Date().toISOString(),
    aggregator_sources: aggregatorResults.map((r) => ({ url: r.url, count: r.events.length, error: r.error })),
    ticket_sources: ticketResults.map((t) => ({ url: t.url, count: t.events.length })),
    upserted: upsertCount,
    unique_events: combined.size,
    upsert_errors: upsertErrors.slice(0, 5),
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
