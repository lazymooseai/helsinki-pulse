/**
 * enrich-event-tickets
 *
 * Taydentaa events-taulun rivit lipunmyyntitiedoilla scrapaamalla
 * tapahtumien source_url -sivut Firecrawlilla (json-extraction).
 *
 * Firecrawl hoitaa JS-renderoinnin + strukturoidun datan poiminnan
 * omilla AI-ominaisuuksillaan (ei kuluta Lovable AI -krediitteja).
 *
 * Logiikka:
 *  - Hakee enintaan 8 tulevaa tapahtumaa, joilla on source_url
 *    JA load_factor IS NULL TAI last_scraped_at > 6h sitten.
 *  - Jokaiselle tehdaan Firecrawl scrape /v2/scrape -endpointilla
 *    json-formatilla ja maaritellylla skeemalla.
 *  - Paivittaa events-tauluun sold_out, load_factor, availability_note.
 *
 * Ajetaan manuaalisesti tai cronilla (esim. 4h valein).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2';
const MAX_PER_RUN = 8;
const STALE_HOURS = 6;

interface EventRow {
  id: string;
  name: string;
  venue: string;
  source_url: string | null;
  load_factor: number | null;
  last_scraped_at: string | null;
  capacity: number | null;
}

interface ScrapedAvailability {
  sold_out: boolean | null;
  available_seats_text: string | null;
  percent_sold_estimate: number | null;
  notes: string | null;
}

const AVAILABILITY_SCHEMA = {
  type: 'object',
  properties: {
    sold_out: {
      type: ['boolean', 'null'],
      description: 'true jos sivulla mainitaan selkeasti "Loppuunmyyty", "Sold Out", "Ei lippuja saatavilla"',
    },
    available_seats_text: {
      type: ['string', 'null'],
      description: 'Lainaus jos sivulla on tarkka tieto saatavuudesta, esim. "Vain 12 lippua jaljella" tai "Hyvin lippuja"',
    },
    percent_sold_estimate: {
      type: ['number', 'null'],
      description: 'Arvio myydyista lipuista 0-100. 100 = loppuunmyyty, 90+ = "Vain X jaljella", 50 = "Hyvin lippuja", null jos ei tietoa',
    },
    notes: {
      type: ['string', 'null'],
      description: 'Vapaa kommentti suomeksi (max 60 merkkia), esim. "Loppuunmyyty", "Vain parvi", "Hyvin lippuja"',
    },
  },
  required: ['sold_out', 'available_seats_text', 'percent_sold_estimate', 'notes'],
  additionalProperties: false,
};

/**
 * Tunnista "ei tietoa" -tyyppiset notesit jotta niita ei nayteta UI:ssa.
 * Firecrawlin AI-extractor saattaa palauttaa selittavan lauseen kun dataa
 * ei loytynyt; nama suodatetaan pois.
 */
const NO_DATA_PATTERNS = [
  /tiedot? puuttu/i,
  /lisatieto/i,
  /ei saatavilla/i,
  /tarkista my[oö]hemm/i,
  /^etsi/i,
  /^haet/i,
  /ei tietoa/i,
  /ei m?yynniss/i, // "Ei myynnissä lippuja" jätetään pois — ei kerro saatavuudesta
];

function isMeaningfulNote(note: string | null | undefined): boolean {
  if (!note) return false;
  const trimmed = note.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  return !NO_DATA_PATTERNS.some((p) => p.test(trimmed));
}

async function scrapeAvailability(
  url: string,
  eventName: string,
  apiKey: string,
): Promise<ScrapedAvailability | null> {
  const prompt = `Etsi tahan tapahtumaan "${eventName}" liittyva lipunmyyntitilanne. ` +
    `Tarkista tarkasti: onko tapahtuma loppuunmyyty? Onko sivulla tieto kuinka monta lippua jaljella? ` +
    `Onko erilliset hintaluokat (parvi/permanto) eri saatavuuksilla? ` +
    `Jos sivu on yleinen ohjelmalista, etsi VAIN tata kyseista tapahtumaa koskevat tiedot, ala arvaa muiden perusteella. ` +
    `Jos tieto puuttuu, palauta null - ALA keksi.`;

  const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: [
        {
          type: 'json',
          schema: AVAILABILITY_SCHEMA,
          prompt,
        },
      ],
      onlyMainContent: true,
      waitFor: 1500,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error(`[enrich] Firecrawl ${res.status} for ${url}: ${t.slice(0, 200)}`);
    return null;
  }

  const data = await res.json();
  // Firecrawl v2 voi palauttaa joko data.json tai data.data.json
  const json = data.data?.json ?? data.json ?? null;
  if (!json || typeof json !== 'object') {
    console.warn(`[enrich] No json in response for ${url}`);
    return null;
  }
  return json as ScrapedAvailability;
}

function deriveLoadFactor(s: ScrapedAvailability): number | null {
  if (s.sold_out === true) return 1.0;
  if (typeof s.percent_sold_estimate === 'number') {
    return Math.max(0, Math.min(100, s.percent_sold_estimate)) / 100;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  if (!FIRECRAWL_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Hae kandidatit: tulevat tapahtumat, joilla source_url, joko ei load_factoria
  // tai stale (>6h sitten paivitetty)
  const staleCutoff = new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString();
  const { data: candidates, error } = await supabase
    .from('events')
    .select('id, name, venue, source_url, load_factor, last_scraped_at, capacity')
    .gte('start_time', new Date().toISOString())
    .lte('start_time', new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString())
    .not('source_url', 'is', null)
    .or(`load_factor.is.null,last_scraped_at.lt.${staleCutoff}`)
    .order('start_time', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    console.error('[enrich] DB error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const events = (candidates ?? []) as EventRow[];
  console.log(`[enrich] Processing ${events.length} events`);

  const results: Array<{ id: string; name: string; ok: boolean; note?: string }> = [];

  for (const ev of events) {
    if (!ev.source_url) continue;
    try {
      const scraped = await scrapeAvailability(ev.source_url, ev.name, FIRECRAWL_API_KEY);
      const now = new Date().toISOString();

      if (!scraped) {
        // Merkitse tarkistetuksi mutta jata data nullksi
        await supabase
          .from('events')
          .update({ last_scraped_at: now })
          .eq('id', ev.id);
        results.push({ id: ev.id, name: ev.name, ok: false, note: 'no data' });
        continue;
      }

      const loadFactor = deriveLoadFactor(scraped);
      const update: Record<string, unknown> = { last_scraped_at: now };
      if (loadFactor !== null) update.load_factor = loadFactor;
      if (scraped.sold_out === true) update.sold_out = true;
      if (isMeaningfulNote(scraped.notes)) {
        update.availability_note = scraped.notes;
      } else {
        // Tyhjenna jos aiemmin oli mutta nyt ei merkityksellinen
        update.availability_note = null;
      }
      if (loadFactor !== null && ev.capacity) {
        update.tickets_sold = Math.round(loadFactor * ev.capacity);
      }
      // Demand level
      if (loadFactor !== null) {
        if (loadFactor >= 0.9) update.demand_level = 'red';
        else if (loadFactor >= 0.65) update.demand_level = 'amber';
        else update.demand_level = 'green';
      }

      await supabase.from('events').update(update).eq('id', ev.id);
      results.push({
        id: ev.id,
        name: ev.name,
        ok: true,
        note: scraped.notes ?? (loadFactor !== null ? `${Math.round(loadFactor * 100)}%` : 'no data'),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      console.error(`[enrich] Error for ${ev.id}: ${msg}`);
      results.push({ id: ev.id, name: ev.name, ok: false, note: msg.slice(0, 100) });
    }
  }

  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
