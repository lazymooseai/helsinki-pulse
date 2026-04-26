/**
 * tolppaLocations.ts
 *
 * Tunnetut taksitolpat Helsinki/Espoo/Vantaa-alueilta koordinaateilla.
 * Käytetään matchaamaan dispatch_scans.tolppa nimi → koordinaatit
 * jotta voidaan laskea etäisyys autosta ja ryhmitellä vyöhykkeisiin.
 *
 * Nimet normalisoidaan (lowercase, ilman ääkkösiä) → tolerantti haku.
 */

export type Zone = "Helsinki keskusta" | "Helsinki itä" | "Helsinki länsi" | "Helsinki pohjoinen" | "Espoo" | "Vantaa" | "Lentoasema";

export interface TolppaLocation {
  name: string;       // virallinen nimi
  aliases?: string[]; // vaihtoehtoiset kirjoitustavat
  lat: number;
  lon: number;
  zone: Zone;
}

/**
 * Tunnetut tolpat. Lista perustuu Helsingin/PKS:n yleisiin taksitolppiin
 * jotka esiintyvät Taksi Helsingin välityslaitteessa.
 */
export const TOLPAT: TolppaLocation[] = [
  // === Helsinki keskusta ===
  { name: "Rautatientori", aliases: ["Rautatieasema", "Rautatieasema P", "Asema-aukio"], lat: 60.1709, lon: 24.9419, zone: "Helsinki keskusta" },
  { name: "Elielinaukio", aliases: ["Eliel"], lat: 60.1718, lon: 24.9396, zone: "Helsinki keskusta" },
  { name: "Kamppi", aliases: ["Kamppi keskus", "Narinkkatori"], lat: 60.1690, lon: 24.9320, zone: "Helsinki keskusta" },
  { name: "Kaisaniemi", lat: 60.1733, lon: 24.9466, zone: "Helsinki keskusta" },
  { name: "Kauppatori", aliases: ["Kolera-allas"], lat: 60.1675, lon: 24.9528, zone: "Helsinki keskusta" },
  { name: "Senaatintori", lat: 60.1696, lon: 24.9519, zone: "Helsinki keskusta" },
  { name: "Erottaja", aliases: ["Erottajan tolppa"], lat: 60.1660, lon: 24.9437, zone: "Helsinki keskusta" },
  { name: "Mannerheimintie", lat: 60.1731, lon: 24.9362, zone: "Helsinki keskusta" },
  { name: "Stockmann", lat: 60.1685, lon: 24.9418, zone: "Helsinki keskusta" },
  { name: "Hakaniemi", lat: 60.1789, lon: 24.9518, zone: "Helsinki keskusta" },
  { name: "Töölöntori", aliases: ["Toolontori", "Töölö"], lat: 60.1820, lon: 24.9210, zone: "Helsinki keskusta" },
  { name: "Kallio", aliases: ["Kallion tolppa"], lat: 60.1842, lon: 24.9508, zone: "Helsinki keskusta" },
  { name: "Sörnäinen", aliases: ["Sornainen", "Sörkkä"], lat: 60.1872, lon: 24.9601, zone: "Helsinki keskusta" },
  { name: "Katajanokan terminaali", aliases: ["Katajanokka"], lat: 60.1664, lon: 24.9690, zone: "Helsinki keskusta" },
  { name: "Olympiaterminaali", lat: 60.1620, lon: 24.9540, zone: "Helsinki keskusta" },
  { name: "Länsiterminaali", aliases: ["Lansiterminaali", "LT2"], lat: 60.1542, lon: 24.9203, zone: "Helsinki länsi" },
  { name: "Jätkäsaari", aliases: ["Jatkasaari"], lat: 60.1551, lon: 24.9180, zone: "Helsinki länsi" },

  // === Helsinki länsi/luode ===
  { name: "Ruoholahti", lat: 60.1639, lon: 24.9150, zone: "Helsinki länsi" },
  { name: "Lauttasaari", lat: 60.1597, lon: 24.8784, zone: "Helsinki länsi" },
  { name: "Munkkivuori", lat: 60.2071, lon: 24.8718, zone: "Helsinki länsi" },
  { name: "Munkkiniemi", lat: 60.1964, lon: 24.8800, zone: "Helsinki länsi" },
  { name: "Meilahti", aliases: ["Meilahden sairaala"], lat: 60.1888, lon: 24.9038, zone: "Helsinki länsi" },

  // === Helsinki pohjoinen ===
  { name: "Pasila", aliases: ["Pasilan asema", "Tripla"], lat: 60.1989, lon: 24.9335, zone: "Helsinki pohjoinen" },
  { name: "Käpylä", aliases: ["Kapyla"], lat: 60.2153, lon: 24.9520, zone: "Helsinki pohjoinen" },
  { name: "Oulunkylä", aliases: ["Oulunkyla"], lat: 60.2293, lon: 24.9678, zone: "Helsinki pohjoinen" },
  { name: "Malmi", aliases: ["Malmin asema"], lat: 60.2510, lon: 25.0090, zone: "Helsinki pohjoinen" },

  // === Helsinki itä ===
  { name: "Itäkeskus", aliases: ["Itakeskus", "Itis"], lat: 60.2103, lon: 25.0807, zone: "Helsinki itä" },
  { name: "Herttoniemi", lat: 60.1929, lon: 25.0354, zone: "Helsinki itä" },
  { name: "Vuosaari", lat: 60.2113, lon: 25.1450, zone: "Helsinki itä" },
  { name: "Mellunmäki", aliases: ["Mellunmaki"], lat: 60.2335, lon: 25.1140, zone: "Helsinki itä" },
  { name: "Kontula", lat: 60.2336, lon: 25.0920, zone: "Helsinki itä" },
  { name: "Myllypuro", lat: 60.2233, lon: 25.0750, zone: "Helsinki itä" },

  // === Espoo ===
  { name: "Tapiola", aliases: ["Tapiolan keskus", "Ainoa"], lat: 60.1755, lon: 24.8047, zone: "Espoo" },
  { name: "Otaniemi", aliases: ["Aalto-yliopisto"], lat: 60.1844, lon: 24.8260, zone: "Espoo" },
  { name: "Keilaniemi", lat: 60.1758, lon: 24.8290, zone: "Espoo" },
  { name: "Leppävaara", aliases: ["Leppavaara", "Sello"], lat: 60.2189, lon: 24.8131, zone: "Espoo" },
  { name: "Espoon keskus", aliases: ["Espoonkeskus", "Espoo asema"], lat: 60.2055, lon: 24.6559, zone: "Espoo" },
  { name: "Matinkylä", aliases: ["Matinkyla", "Iso Omena"], lat: 60.1606, lon: 24.7383, zone: "Espoo" },
  { name: "Kivenlahti", lat: 60.1500, lon: 24.6500, zone: "Espoo" },
  { name: "Westend", lat: 60.1700, lon: 24.8200, zone: "Espoo" },
  { name: "Niittykumpu", lat: 60.1700, lon: 24.7700, zone: "Espoo" },

  // === Vantaa ===
  { name: "Tikkurila", aliases: ["Tikkurilan asema", "Dixi"], lat: 60.2925, lon: 25.0440, zone: "Vantaa" },
  { name: "Myyrmäki", aliases: ["Myyrmaki", "Myyrmanni"], lat: 60.2614, lon: 24.8543, zone: "Vantaa" },
  { name: "Hakunila", lat: 60.2700, lon: 25.1000, zone: "Vantaa" },
  { name: "Korso", lat: 60.3414, lon: 25.0867, zone: "Vantaa" },
  { name: "Martinlaakso", lat: 60.2806, lon: 24.8419, zone: "Vantaa" },
  { name: "Jumbo", aliases: ["Flamingo", "Jumbo Flamingo"], lat: 60.2880, lon: 25.0370, zone: "Vantaa" },
  { name: "Aviapolis", lat: 60.2960, lon: 24.9550, zone: "Lentoasema" },
  { name: "Helsinki-Vantaa", aliases: ["Lentoasema", "Lentokenttä", "T2", "T1", "HEL"], lat: 60.3172, lon: 24.9633, zone: "Lentoasema" },
];

/** Normalisoi nimi: lowercase, ilman ääkkösiä, ilman välimerkkejä. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Etsi tolppa nimellä tai aliaksella. Palauttaa undefined jos ei löydy. */
export function findTolppa(name: string): TolppaLocation | undefined {
  const n = normalize(name);
  if (!n) return undefined;
  // 1. Täsmälleen sama
  for (const t of TOLPAT) {
    if (normalize(t.name) === n) return t;
    if (t.aliases?.some((a) => normalize(a) === n)) return t;
  }
  // 2. Sisältyy nimeen tai päinvastoin (esim. "Pasilan asema P3" → "Pasila")
  for (const t of TOLPAT) {
    const tn = normalize(t.name);
    if (n.includes(tn) || tn.includes(n)) return t;
    if (t.aliases?.some((a) => {
      const an = normalize(a);
      return n.includes(an) || an.includes(n);
    })) return t;
  }
  return undefined;
}

/** Haversine etäisyys kilometreinä. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

export const ALL_ZONES: Zone[] = [
  "Helsinki keskusta",
  "Helsinki itä",
  "Helsinki länsi",
  "Helsinki pohjoinen",
  "Espoo",
  "Vantaa",
  "Lentoasema",
];

/** Vyöhykkeen keskipiste (manuaalivalintaa varten). */
export const ZONE_CENTERS: Record<Zone, { lat: number; lon: number }> = {
  "Helsinki keskusta": { lat: 60.1699, lon: 24.9420 },
  "Helsinki itä": { lat: 60.2100, lon: 25.0800 },
  "Helsinki länsi": { lat: 60.1640, lon: 24.9000 },
  "Helsinki pohjoinen": { lat: 60.2150, lon: 24.9500 },
  "Espoo": { lat: 60.2055, lon: 24.6559 },
  "Vantaa": { lat: 60.2925, lon: 25.0440 },
  "Lentoasema": { lat: 60.3172, lon: 24.9633 },
};