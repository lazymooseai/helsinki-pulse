/**
 * areas.ts
 *
 * Helsingin/PKS:n nimetyt alueet ja lähimmän alueen haku koordinaateista.
 * Käytetään muuntamaan raakat lat,lon -merkkijonot luettaviksi paikkanimiksi
 * historian ja patternien näyttöä varten.
 */

export interface NamedArea {
  name: string;
  lat: number;
  lon: number;
  radiusKm?: number; // ohjeellinen vaikutusalue (default 1.2 km)
}

/**
 * Keskeiset lähtö-/kohdealueet — tihennetty ydin Helsinkiin koska
 * suurin osa kyydeistä alkaa keskustasta. Pisteet ovat lähtöpisteen
 * keskimääräisiä koordinaatteja.
 */
export const NAMED_AREAS: NamedArea[] = [
  // --- Keskusta-Helsinki (tiheä) ---
  { name: "Rautatieasema", lat: 60.1719, lon: 24.9414, radiusKm: 0.4 },
  { name: "Asema-aukio", lat: 60.1709, lon: 24.9419, radiusKm: 0.3 },
  { name: "Aleksanterinkatu", lat: 60.1689, lon: 24.9462, radiusKm: 0.4 },
  { name: "Senaatintori", lat: 60.1696, lon: 24.9519, radiusKm: 0.3 },
  { name: "Kauppatori", lat: 60.1675, lon: 24.9528, radiusKm: 0.3 },
  { name: "Esplanadi", lat: 60.1679, lon: 24.9444, radiusKm: 0.4 },
  { name: "Erottaja", lat: 60.1660, lon: 24.9437, radiusKm: 0.3 },
  { name: "Kamppi", lat: 60.1690, lon: 24.9320, radiusKm: 0.5 },
  { name: "Kluuvi", lat: 60.1716, lon: 24.9456, radiusKm: 0.3 },
  { name: "Kruununhaka", lat: 60.1737, lon: 24.9568, radiusKm: 0.5 },
  { name: "Katajanokka", lat: 60.1660, lon: 24.9678, radiusKm: 0.6 },
  { name: "Kaivopuisto", lat: 60.1565, lon: 24.9595, radiusKm: 0.7 },
  { name: "Eira", lat: 60.1573, lon: 24.9425, radiusKm: 0.5 },
  { name: "Punavuori", lat: 60.1614, lon: 24.9379, radiusKm: 0.5 },
  { name: "Ullanlinna", lat: 60.1594, lon: 24.9494, radiusKm: 0.5 },
  { name: "Hietalahti", lat: 60.1626, lon: 24.9293, radiusKm: 0.4 },
  { name: "Kallio", lat: 60.1842, lon: 24.9508, radiusKm: 0.7 },
  { name: "Hakaniemi", lat: 60.1789, lon: 24.9518, radiusKm: 0.4 },
  { name: "Sörnäinen", lat: 60.1872, lon: 24.9601, radiusKm: 0.7 },
  { name: "Kalasatama", lat: 60.1867, lon: 24.9772, radiusKm: 0.7 },
  { name: "Töölö", lat: 60.1820, lon: 24.9210, radiusKm: 0.7 },
  { name: "Töölönlahti", lat: 60.1781, lon: 24.9356, radiusKm: 0.4 },
  { name: "Kamppi-Ruoholahti", lat: 60.1657, lon: 24.9152, radiusKm: 0.5 },
  { name: "Ruoholahti", lat: 60.1639, lon: 24.9150, radiusKm: 0.6 },
  { name: "Jätkäsaari", lat: 60.1551, lon: 24.9180, radiusKm: 0.8 },
  { name: "Lauttasaari", lat: 60.1597, lon: 24.8784, radiusKm: 1.2 },
  { name: "Pasila", lat: 60.1989, lon: 24.9335, radiusKm: 0.8 },
  { name: "Pasilan asema", lat: 60.1986, lon: 24.9337, radiusKm: 0.4 },
  { name: "Vallila", lat: 60.1948, lon: 24.9525, radiusKm: 0.6 },
  { name: "Arabianranta", lat: 60.2078, lon: 24.9786, radiusKm: 0.8 },
  { name: "Kumpula", lat: 60.2060, lon: 24.9655, radiusKm: 0.6 },
  { name: "Käpylä", lat: 60.2153, lon: 24.9520, radiusKm: 0.8 },
  { name: "Oulunkylä", lat: 60.2293, lon: 24.9678, radiusKm: 1.0 },
  { name: "Munkkiniemi", lat: 60.1964, lon: 24.8800, radiusKm: 1.0 },
  { name: "Munkkivuori", lat: 60.2071, lon: 24.8718, radiusKm: 0.8 },
  { name: "Meilahti", lat: 60.1888, lon: 24.9038, radiusKm: 0.7 },
  { name: "Pikku Huopalahti", lat: 60.2070, lon: 24.8927, radiusKm: 0.7 },
  { name: "Haaga", lat: 60.2243, lon: 24.8838, radiusKm: 1.2 },
  { name: "Pohjois-Haaga", lat: 60.2350, lon: 24.8950, radiusKm: 0.8 },
  { name: "Pitäjänmäki", lat: 60.2240, lon: 24.8512, radiusKm: 1.2 },
  { name: "Konala", lat: 60.2360, lon: 24.8390, radiusKm: 1.2 },
  { name: "Malminkartano", lat: 60.2526, lon: 24.8500, radiusKm: 1.0 },
  { name: "Myllypuro", lat: 60.2233, lon: 25.0750, radiusKm: 1.0 },
  { name: "Itäkeskus", lat: 60.2103, lon: 25.0807, radiusKm: 1.0 },
  { name: "Herttoniemi", lat: 60.1929, lon: 25.0354, radiusKm: 1.0 },
  { name: "Roihuvuori", lat: 60.2018, lon: 25.0567, radiusKm: 0.8 },
  { name: "Kulosaari", lat: 60.1880, lon: 25.0102, radiusKm: 0.8 },
  { name: "Vuosaari", lat: 60.2113, lon: 25.1450, radiusKm: 1.5 },
  { name: "Mellunmäki", lat: 60.2335, lon: 25.1140, radiusKm: 1.0 },
  { name: "Kontula", lat: 60.2336, lon: 25.0920, radiusKm: 1.0 },
  { name: "Malmi", lat: 60.2510, lon: 25.0090, radiusKm: 1.2 },
  { name: "Tapanila", lat: 60.2620, lon: 25.0250, radiusKm: 0.8 },
  { name: "Pukinmäki", lat: 60.2425, lon: 24.9960, radiusKm: 0.8 },
  { name: "Tapaninkylä", lat: 60.2680, lon: 25.0420, radiusKm: 1.0 },
  { name: "Viikki", lat: 60.2270, lon: 25.0190, radiusKm: 1.2 },

  // --- Espoo ---
  { name: "Tapiola", lat: 60.1755, lon: 24.8047, radiusKm: 1.2 },
  { name: "Otaniemi", lat: 60.1844, lon: 24.8260, radiusKm: 1.0 },
  { name: "Keilaniemi", lat: 60.1758, lon: 24.8290, radiusKm: 0.6 },
  { name: "Leppävaara", lat: 60.2189, lon: 24.8131, radiusKm: 1.2 },
  { name: "Espoon keskus", lat: 60.2055, lon: 24.6559, radiusKm: 1.2 },
  { name: "Matinkylä", lat: 60.1606, lon: 24.7383, radiusKm: 1.2 },
  { name: "Kivenlahti", lat: 60.1500, lon: 24.6500, radiusKm: 1.0 },

  // --- Vantaa ---
  { name: "Helsinki-Vantaa lentoasema", lat: 60.3172, lon: 24.9633, radiusKm: 2.0 },
  { name: "Tikkurila", lat: 60.2925, lon: 25.0440, radiusKm: 1.2 },
  { name: "Myyrmäki", lat: 60.2614, lon: 24.8543, radiusKm: 1.2 },
  { name: "Aviapolis", lat: 60.2960, lon: 24.9550, radiusKm: 1.5 },
  { name: "Jumbo / Flamingo", lat: 60.2880, lon: 25.0370, radiusKm: 0.8 },
  { name: "Hakunila", lat: 60.2700, lon: 25.1000, radiusKm: 1.2 },

  // --- Satamat & terminaalit ---
  { name: "Länsiterminaali", lat: 60.1542, lon: 24.9203, radiusKm: 0.5 },
  { name: "Olympiaterminaali", lat: 60.1620, lon: 24.9540, radiusKm: 0.4 },
  { name: "Katajanokan terminaali", lat: 60.1664, lon: 24.9690, radiusKm: 0.4 },
  { name: "Hernesaari", lat: 60.1490, lon: 24.9230, radiusKm: 0.5 },
];

/** Koordinaatti merkkijonosta "lat,lon" tai osoitemerkkijonosta. */
export function parseLatLonString(s: string | null | undefined): { lat: number; lon: number } | null {
  if (!s) return null;
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/** Haversine-etäisyys kilometreinä. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Karkea fallback kunnan/alueen mukaan kun mikään NAMED_AREAS ei ole tarpeeksi lähellä.
 */
function coarseFallback(lat: number, lon: number): string {
  // Hyvin karkea bounding-box-luokittelu PKS-tasolla
  if (lat >= 60.13 && lat <= 60.30 && lon >= 24.83 && lon <= 25.20) return "Muu Helsinki";
  if (lat >= 60.13 && lat <= 60.35 && lon >= 24.40 && lon <= 24.83) return "Espoo";
  if (lat >= 60.27 && lat <= 60.40 && lon >= 24.83 && lon <= 25.20) return "Vantaa";
  if (lon > 25.20) return "Itä-Uusimaa";
  if (lon < 24.40) return "Länsi-Uusimaa";
  return "Muu PKS";
}

/**
 * Etsi lähin nimetty alue. Jos lähin > maxDistanceKm (default 1.5 km),
 * palautetaan karkea kunta-fallback.
 */
export function nearestArea(lat: number, lon: number, maxDistanceKm = 1.5): string {
  let bestName = "";
  let bestDist = Infinity;
  for (const a of NAMED_AREAS) {
    const d = haversineKm(lat, lon, a.lat, a.lon);
    // Painota säde mukaan: jos koordinaatti on aluerajan sisällä, suosi sitä
    const adjusted = d - (a.radiusKm ?? 1.2) * 0.3;
    if (adjusted < bestDist) {
      bestDist = adjusted;
      bestName = a.name;
    }
  }
  if (bestDist > maxDistanceKm) return coarseFallback(lat, lon);
  return bestName || coarseFallback(lat, lon);
}

/**
 * Päättele alueen nimi joko koordinaateista tai "lat,lon" -merkkijonosta.
 * Jos osoite ei ole numeerinen pari, palauttaa alkuperäisen tekstin.
 */
export function resolveAreaName(
  address: string | null | undefined,
  lat: number | null | undefined,
  lon: number | null | undefined,
): string {
  if (typeof lat === "number" && typeof lon === "number") {
    return nearestArea(lat, lon);
  }
  const parsed = parseLatLonString(address);
  if (parsed) return nearestArea(parsed.lat, parsed.lon);
  return (address ?? "—").trim() || "—";
}