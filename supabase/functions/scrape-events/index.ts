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
  'Tapiolasali': 700,
  'Finlandia-talo': 1700,
  'Peacock-teatteri': 600,
  'Svenska Teatern': 500,
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
  const results: Array<{ venue: string; ok: boolean; count: number; error?: string }> = [];

  for (const venue of VENUES) {
    try {
      console.log(`Scraping ${venue.name} (${venue.url})`);
      const markdown = await firecrawlScrape(venue.url, FIRECRAWL_API_KEY);
      if (!markdown) {
        results.push({ venue: venue.name, ok: false, count: 0, error: 'empty markdown' });
        continue;
      }
      const events = await aiParseEvents(venue.name, markdown, LOVABLE_API_KEY);
      console.log(`${venue.name}: ${events.length} events parsed from program page`);

      // Lipunmyyntisivu: hae tarkemmat saatavuustiedot ja yhdistä events-listaan nimen perusteella
      if (venue.ticketsUrl && events.length > 0) {
        try {
          console.log(`Scraping tickets for ${venue.name} (${venue.ticketsUrl})`);
          const ticketsMd = await firecrawlScrape(venue.ticketsUrl, FIRECRAWL_API_KEY);
          if (ticketsMd) {
            const ticketEvents = await aiParseEvents(venue.name, ticketsMd, LOVABLE_API_KEY);
            console.log(`${venue.name}: ${ticketEvents.length} ticket entries found`);
            // Yhdistä saatavuustiedot ohjelmasivun tapahtumiin nimi-matchilla
            for (const ev of events) {
              const match = ticketEvents.find((te) => {
                const a = te.name.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
                const b = ev.name.toLowerCase().replace(/[^a-zåäö0-9]/g, '');
                return a.includes(b) || b.includes(a);
              });
              if (match) {
                ev.sold_out = match.sold_out ?? ev.sold_out;
                ev.load_factor = match.load_factor ?? ev.load_factor;
                ev.availability_note = match.availability_note ?? ev.availability_note;
              }
            }
          }
        } catch (e) {
          console.warn(`Tickets scrape failed for ${venue.name}:`, e instanceof Error ? e.message : String(e));
        }
      }

      // Upsert events
      let count = 0;
      for (const ev of events) {
        const externalId = `scraped:${venue.name}:${ev.start_time}:${ev.name.slice(0, 50)}`;
        const tickets_sold = ev.load_factor != null && venue.capacity
          ? Math.round(venue.capacity * ev.load_factor)
          : null;
        const demand_level: 'red' | 'amber' | 'green' = ev.sold_out || (ev.load_factor ?? 0) >= 0.9
          ? 'red'
          : (ev.load_factor ?? 0) >= 0.7
          ? 'amber'
          : 'green';
        const demand_tag = ev.sold_out
          ? 'LOPPUUNMYYTY'
          : (ev.load_factor ?? 0) >= 0.9
          ? 'KORKEA KYSYNTÄ'
          : (ev.load_factor ?? 0) >= 0.7
          ? 'PREMIUM'
          : 'NORMAALI';

        const { error } = await supabase.from('events').upsert({
          external_id: externalId,
          name: ev.name,
          venue: venue.name,
          start_time: ev.start_time,
          end_time: ev.end_time ?? null,
          capacity: venue.capacity,
          tickets_sold,
          load_factor: ev.load_factor ?? null,
          sold_out: !!ev.sold_out,
          demand_level,
          demand_tag,
          source_url: venue.url,
          source: 'scraper',
          is_manual: false,
          last_scraped_at: new Date().toISOString(),
        }, { onConflict: 'external_id' });

        if (!error) count++;
        else console.warn(`Upsert err for ${ev.name}:`, error.message);
      }
      results.push({ venue: venue.name, ok: true, count });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed ${venue.name}:`, msg);
      results.push({ venue: venue.name, ok: false, count: 0, error: msg });
    }
  }

  // Siivoa vanhat skrapatut tapahtumat (yli 7 pv menneisyydessä)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('events').delete().eq('source', 'scraper').lt('start_time', cutoff);

  return new Response(JSON.stringify({
    ok: true,
    timestamp: new Date().toISOString(),
    results,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
