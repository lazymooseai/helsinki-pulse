import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AverioShip {
  arrivalTime: string;
  harbor: string;
  ship: string;
  pax: number;
}

// Tunnetut laivat ja niiden oikeat terminaalit
// Lahde: Helsingin satama virallinen terminaalikartta
const SHIP_TERMINAL_MAP: Record<string, string> = {
  // Silja Line -> P1 Olympiaterminaali
  'serenade': 'Olympiaterminaali',
  'symphony': 'Olympiaterminaali',
  'galaxy': 'Olympiaterminaali',
  'silja serenade': 'Olympiaterminaali',
  'silja symphony': 'Olympiaterminaali',
  'silja galaxy': 'Olympiaterminaali',
  // Viking Line -> P2 Katajanokka
  'grace': 'Katajanokka',
  'cinderella': 'Katajanokka',
  'isabella': 'Katajanokka',
  'xprs': 'Katajanokka',
  'viking xprs': 'Katajanokka',
  'viking grace': 'Katajanokka',
  'viking cinderella': 'Katajanokka',
  'viking isabella': 'Katajanokka',
  // Tallink -> P3 Lansiterminaali
  'megastar': 'Länsiterminaali',
  'star': 'Länsiterminaali',
  'romantika': 'Länsiterminaali',
  'tallink megastar': 'Länsiterminaali',
  'tallink star': 'Länsiterminaali',
};

// Maksimimatkustajat terminaaleittain
const TERMINAL_MAX_PAX: Record<string, number> = {
  'Olympiaterminaali': 2852,  // Silja Serenade kapasiteetti
  'Katajanokka': 2800,        // Viking Grace kapasiteetti
  'Länsiterminaali': 2800,    // Tallink Megastar kapasiteetti
};

function parseAverioHtml(html: string): AverioShip[] {
  const ships: AverioShip[] = [];
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gs;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const arrivalTime = match[1].replace(/<[^>]*>/g, '').trim();
    const harbor     = match[2].replace(/<[^>]*>/g, '').trim();
    const ship       = match[3].replace(/<[^>]*>/g, '').trim();
    const paxStr     = match[4].replace(/<[^>]*>/g, '').trim();
    const pax        = parseInt(paxStr, 10);

    if (!arrivalTime || arrivalTime === 'Saapumisaika') continue;
    // Skippaa Averion sivutus-/footer-rivit (esim. "1/16", "2/16")
    if (/^\d+\s*\/\s*\d+$/.test(arrivalTime) || /^\d+\s*\/\s*\d+/.test(harbor) || /^\d+\s*\/\s*\d+/.test(ship)) continue;
    // Aikaformaatti pitaa olla "HH:MM ..." muutoin skipataan
    if (!/^\d{1,2}:\d{2}/.test(arrivalTime)) continue;

    ships.push({
      arrivalTime,
      harbor,
      ship,
      pax: isNaN(pax) ? 0 : pax,
    });
  }
  return ships;
}

/**
 * Parsii Port of Helsinki -saapumistaulukon (toinen <table> sivulla).
 * Rivi: <td>28.4.2026 00:30</td><td>Megastar</td><td>Tallink Silja Oy</td>
 *       <td class="from">Tallinn</td><td class="terminal">West Terminal 2</td>
 * Palauttaa { ship, terminal, arrivalTime } "HH:MM DD.MM.YYYY" -muodossa
 * Averion kanssa yhteensopivasti.
 */
function parsePortOfHelsinkiArrivals(html: string): Array<{ ship: string; terminal: string; arrivalTime: string }> {
  const out: Array<{ ship: string; terminal: string; arrivalTime: string }> = [];
  // Etsi rivit, joissa on 'class="from"' (= saapuvat)
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2})<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*class="from"[^>]*>[^<]*<\/td>\s*<td[^>]*class="terminal"[^>]*>([^<]+)<\/td>\s*<\/tr>/g;
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const dateTime = m[1].trim(); // "28.4.2026 00:30"
    const ship = m[2].trim();
    const terminalRaw = m[3].trim();
    // Muunna "D.M.YYYY HH:MM" -> "HH:MM DD.MM.YYYY" (Averio-formaatti)
    const parts = dateTime.split(/\s+/);
    const [d, mo, y] = parts[0].split('.');
    const hhmm = parts[1];
    const dd = d.padStart(2, '0');
    const mm = mo.padStart(2, '0');
    out.push({
      ship,
      terminal: terminalRaw,
      arrivalTime: `${hhmm} ${dd}.${mm}.${y}`,
    });
  }
  return out;
}

/** Map PoH terminal name -> sisainen terminaali */
function mapPohTerminal(t: string): string {
  const s = t.toLowerCase();
  if (s.includes('olympia')) return 'Olympiaterminaali';
  if (s.includes('katajanokka')) return 'Katajanokka';
  if (s.includes('west')) return 'Länsiterminaali';
  if (s.includes('hansa') || s.includes('vuosaari') || s.includes('muuga')) return 'Vuosaari';
  return t;
}

/** Parsii "HH:MM DD.MM.YYYY" -> Date */
function parseShipDate(s: string): Date | null {
  const parts = s.split(/\s+/);
  if (parts.length < 2) return null;
  const [hh, mm] = parts[0].split(':').map(Number);
  const [d, mo, y] = parts[1].split('.').map(Number);
  if (isNaN(hh) || isNaN(mm) || isNaN(d) || isNaN(mo) || isNaN(y)) return null;
  return new Date(y, mo - 1, d, hh, mm, 0);
}

/**
 * Maarittaa oikean terminaalin kahdella tasolla:
 * 1. Laivan nimen perusteella (tarkin tieto)
 * 2. Averion satamakentin perusteella (varavaihtoehto)
 *
 * P1 = Olympiaterminaali -> Silja Line (Serenade, Symphony, Galaxy)
 * P2 = Katajanokka       -> Viking Line (Grace, Cinderella, Isabella)
 * P3 = Lansiterminaali   -> Tallink (Megastar, Star, Romantika)
 */
function resolveTerminal(ship: string, averioHarbor: string): string {
  // Taso 1: laivan nimi (luotettavin)
  const shipLower = ship.toLowerCase().trim();
  for (const [key, terminal] of Object.entries(SHIP_TERMINAL_MAP)) {
    if (shipLower.includes(key)) return terminal;
  }

  // Taso 2: Averion satamatieto (varavaihtoehto)
  const h = averioHarbor.toLowerCase();
  if (h.includes('olympia'))                              return 'Olympiaterminaali';
  if (h.includes('katajanokka'))                          return 'Katajanokka';
  if (h.includes('länsi') || h.includes('lansi'))         return 'Länsiterminaali';
  if (h.includes('etelä') || h.includes('etela'))         return 'Olympiaterminaali'; // Eteläsatama = Olympia-alue

  // Taso 3: tuntematon -> palautetaan sellaisenaan
  return averioHarbor;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1) Averio (sisaltaa pax-arviot)
    const averioRes = await fetch('https://averio.fi/laivat', {
      headers: { 'User-Agent': 'HelsinkiTaxiPulse/2.0' },
    });
    if (!averioRes.ok) throw new Error(`Averio fetch failed: ${averioRes.status}`);
    const html = await averioRes.text();
    const rawShips = parseAverioHtml(html);

    // 2) Port of Helsinki (virallinen aikataulu, ei pax-tietoja)
    let pohArrivals: Array<{ ship: string; terminal: string; arrivalTime: string }> = [];
    try {
      const pohRes = await fetch(
        'https://www.portofhelsinki.fi/en/passengers/information-for-passengers/arrivals-and-departures/',
        { headers: { 'User-Agent': 'HelsinkiTaxiPulse/2.0' } },
      );
      if (pohRes.ok) {
        const pohHtml = await pohRes.text();
        pohArrivals = parsePortOfHelsinkiArrivals(pohHtml);
      }
    } catch (e) {
      console.warn('Port of Helsinki fetch epaonnistui:', (e as Error).message);
    }

    const terminalEstimates: Record<string, { estimate: number; maxCapacity: number; factor: number }> = {};
    const shipList: Array<{ ship: string; harbor: string; pax: number; arrivalTime: string }> = [];
    const seen = new Set<string>(); // dedupe-key: ship|arrivalTime

    for (const s of rawShips) {
      const terminal = resolveTerminal(s.ship, s.harbor);
      const key = `${s.ship.toLowerCase()}|${s.arrivalTime}`;
      seen.add(key);

      shipList.push({
        ship: s.ship,
        harbor: terminal,
        pax: s.pax,
        arrivalTime: s.arrivalTime,
      });

      if (!terminalEstimates[terminal]) {
        const maxCap = TERMINAL_MAX_PAX[terminal] ?? 2800;
        terminalEstimates[terminal] = { estimate: 0, maxCapacity: maxCap, factor: 0 };
      }
      terminalEstimates[terminal].estimate += s.pax;
    }

    // 3) Lisaa PoH:n saapuvat laivat, joita Averiossa ei ollut (esim. yo-vuorot).
    //    Pax = 0 (ei tiedossa). Skipataan rahtilaivat ja Vuosaari/Muuga.
    const now = Date.now();
    const horizonMs = 6 * 60 * 60 * 1000; // 6h ikkuna
    const cargoBlacklist = /finbo cargo|finnmaid|finnstar|finnlady|finntrader|finnsea|finnpulp|finnsky/i;
    for (const a of pohArrivals) {
      if (cargoBlacklist.test(a.ship)) continue;
      const terminal = mapPohTerminal(a.terminal);
      if (terminal === 'Vuosaari') continue; // ei taksitoiminnan kannalta relevantti
      const key = `${a.ship.toLowerCase()}|${a.arrivalTime}`;
      if (seen.has(key)) continue;
      const dt = parseShipDate(a.arrivalTime);
      if (!dt) continue;
      const diff = dt.getTime() - now;
      // Vain tulevat (max 6h) — varmistaa ettei lisata vanhentuneita rivejä
      if (diff < -10 * 60 * 1000 || diff > horizonMs) continue;
      seen.add(key);

      shipList.push({
        ship: a.ship,
        harbor: terminal,
        pax: 0,
        arrivalTime: a.arrivalTime,
      });

      if (!terminalEstimates[terminal]) {
        const maxCap = TERMINAL_MAX_PAX[terminal] ?? 2800;
        terminalEstimates[terminal] = { estimate: 0, maxCapacity: maxCap, factor: 0 };
      }
      // pax = 0 -> ei kasvateta estimaattia
    }

    // Laske tayttoprosentti
    for (const key of Object.keys(terminalEstimates)) {
      const est = terminalEstimates[key];
      est.factor = est.maxCapacity > 0
        ? Math.min(100, Math.round((est.estimate / est.maxCapacity) * 100))
        : 0;
    }

    // 4) Tallenna havainnot historia-tauluun oppimista varten.
    //    Vain laivat joilla on pax > 0 (eli Averio antoi luvun) — nämä ovat
    //    "todellisia" havaintoja joita vasten agentin ennusteita verrataan.
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      if (supabaseUrl && serviceKey && shipList.length > 0) {
        const sb = createClient(supabaseUrl, serviceKey);

        // Hae sää (Helsinki) yhdellä kutsulla — käytetään kaikille riveille
        let weatherCode: number | null = null;
        let temperatureC: number | null = null;
        try {
          const wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=60.17&longitude=24.94&current=temperature_2m,weather_code&timezone=Europe%2FHelsinki');
          if (wRes.ok) {
            const w = await wRes.json();
            weatherCode  = w?.current?.weather_code ?? null;
            temperatureC = w?.current?.temperature_2m ?? null;
          }
        } catch (_) { /* ignore */ }

        const rows = shipList
          .filter(s => s.pax > 0) // vain todelliset havainnot
          .map(s => {
            const dt = parseShipDate(s.arrivalTime);
            if (!dt) return null;
            const dow = ((dt.getDay() + 6) % 7) + 1; // ISO 1..7 (Mon=1)
            return {
              ship: s.ship,
              terminal: s.harbor,
              arrival_time: dt.toISOString(),
              pax: s.pax,
              day_of_week: dow,
              hour_of_day: dt.getHours(),
              month_num: dt.getMonth() + 1,
              is_weekend: dow >= 6,
              weather_code: weatherCode,
              temperature_c: temperatureC,
              source: 'averio',
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rows.length > 0) {
          const { error: upErr } = await sb
            .from('ship_pax_history')
            .upsert(rows, { onConflict: 'ship,arrival_time,source', ignoreDuplicates: false });
          if (upErr) console.warn('ship_pax_history upsert virhe:', upErr.message);
        }

        // 5) Päivitä aiempien ennusteiden actual_pax (jos ennuste on jo tehty
        //    näille saapumisille) jotta agentti voi mitata tarkkuutensa.
        for (const s of shipList.filter(x => x.pax > 0)) {
          const dt = parseShipDate(s.arrivalTime);
          if (!dt) continue;
          const { data: preds } = await sb
            .from('ship_pax_predictions')
            .select('id, predicted_pax')
            .eq('ship', s.ship)
            .eq('arrival_time', dt.toISOString())
            .is('actual_pax', null);
          if (!preds || preds.length === 0) continue;
          for (const p of preds) {
            const errAbs = Math.abs((p.predicted_pax ?? 0) - s.pax);
            const errPct = s.pax > 0 ? (errAbs / s.pax) * 100 : null;
            await sb.from('ship_pax_predictions').update({
              actual_pax: s.pax,
              error_abs: errAbs,
              error_pct: errPct,
              evaluated_at: new Date().toISOString(),
            }).eq('id', p.id);
          }
        }
      }
    } catch (e) {
      console.warn('Historia/ennuste-talletus epaonnistui:', (e as Error).message);
    }

    return new Response(JSON.stringify({
      estimates: terminalEstimates,
      ships: shipList,
      source: 'Averio.fi / Port of Helsinki',
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Averio fetch error:', error);
    // Palautetaan 200 + fallback-lippu, jotta frontend ei kaadu eika nayta tyhjaa ruutua
    return new Response(JSON.stringify({
      estimates: {},
      ships: [],
      source: 'fallback',
      fallback: true,
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
