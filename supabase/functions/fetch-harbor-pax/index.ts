import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
  'viking grace': 'Katajanokka',
  'viking cinderella': 'Katajanokka',
  'viking isabella': 'Katajanokka',
  // Tallink -> P3 Lansiterminaali
  'megastar': 'Lansiterminaali',
  'star': 'Lansiterminaali',
  'romantika': 'Lansiterminaali',
  'tallink megastar': 'Lansiterminaali',
  'tallink star': 'Lansiterminaali',
};

// Maksimimatkustajat terminaaleittain
const TERMINAL_MAX_PAX: Record<string, number> = {
  'Olympiaterminaali': 2852,  // Silja Serenade kapasiteetti
  'Katajanokka': 2800,        // Viking Grace kapasiteetti
  'Lansiterminaali': 2800,    // Tallink Megastar kapasiteetti
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
  if (h.includes('lansi') || h.includes('lansisatama'))   return 'Lansiterminaali';
  if (h.includes('etela') || h.includes('eteläsatama'))   return 'Olympiaterminaali'; // Eteläsatama = Olympia-alue

  // Taso 3: tuntematon -> palautetaan sellaisenaan
  return averioHarbor;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const response = await fetch('https://averio.fi/laivat', {
      headers: { 'User-Agent': 'HelsinkiTaxiPulse/2.0' },
    });

    if (!response.ok) {
      throw new Error(`Averio fetch failed: ${response.status}`);
    }

    const html = await response.text();
    const rawShips = parseAverioHtml(html);

    const terminalEstimates: Record<string, { estimate: number; maxCapacity: number; factor: number }> = {};
    const shipList: Array<{ ship: string; harbor: string; pax: number; arrivalTime: string }> = [];

    for (const s of rawShips) {
      const terminal = resolveTerminal(s.ship, s.harbor);

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

    // Laske tayttoprosentti
    for (const key of Object.keys(terminalEstimates)) {
      const est = terminalEstimates[key];
      est.factor = est.maxCapacity > 0
        ? Math.min(100, Math.round((est.estimate / est.maxCapacity) * 100))
        : 0;
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
