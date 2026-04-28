import { TrainDelay } from "./types";

export type TrainStation = "HKI" | "PSL" | "TKL";

// Junatyypin oletuskapasiteetti kun /compositions ei vastaa
// Laskettu VR:n julkisista kalustotiedoista (istumapaikat)
const TRAIN_TYPE_CAPACITY: Record<string, number> = {
  S:   297,   // Pendolino Sm6
  IC:  480,   // InterCity 2 (keskiarvo)
  P:   360,   // Pikajuna
  AE:  352,   // Allegro (historiallinen)
  DEFAULT: 350,
};

function getTypeCapacity(line: string): number {
  const type = line.replace(/\d+/g, "").trim().toUpperCase();
  return TRAIN_TYPE_CAPACITY[type] ?? TRAIN_TYPE_CAPACITY.DEFAULT;
}

async function fetchTrainSeats(
  trainNumber: number,
  departureDate: string
): Promise<number | null> {
  try {
    const url = `https://rata.digitraffic.fi/api/v1/compositions/${departureDate}/${trainNumber}`;
    const resp = await fetch(url, {
      headers: { "Digitraffic-User": "HelsinkiTaxiPulse/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    let total = 0;
    for (const section of data?.journeySections ?? []) {
      for (const wagon of section?.wagons ?? []) {
        total += (wagon.seating ?? 0) + (wagon.seatingDisabled ?? 0);
      }
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

export const TRAIN_STATIONS: { code: TrainStation; name: string }[] = [
  { code: "HKI", name: "Helsinki" },
  { code: "PSL", name: "Pasila" },
  { code: "TKL", name: "Tikkurila" },
];

// Nayta jopa 100 saapuvaa junaa - tarvitaan korkea raja erityisesti Pasilalle,
// jossa lahijunat tayttavat kiintion ennen kaukojunia. Long-distance + 60min
// ikkuna karsii listan myohemmin pieneksi.
function getFintrafficUrl(station: TrainStation): string {
  return (
    `https://rata.digitraffic.fi/api/v1/live-trains/station/${station}` +
    `?arrived_trains=3&arriving_trains=100&departing_trains=0&include_nonstopping=false`
  );
}

// Asemien lyhytkoodit -> kaupunkinimet
const STATION_NAMES: Record<string, string> = {
  OL:  "Oulu",        TPE: "Tampere",     TKU: "Turku",
  JY:  "Jyväskylä",   KUO: "Kuopio",      JNS: "Joensuu",
  ROI: "Rovaniemi",   KEM: "Kemi",        SEI: "Seinäjoki",
  LH:  "Lahti",       LR:  "Lahti",       KOK: "Kokkola",
  MI:  "Mikkeli",     PM:  "Pieksämäki",  VS:  "Vaasa",
  VNS: "Vaasa",       KAJ: "Kajaani",     LPV: "Lappeenranta",
  LR2: "Lappeenranta",RI:  "Riihimäki",   HKI: "Helsinki",
  PSL: "Pasila",      TKL: "Tikkurila",   KV:  "Kouvola",
  HL:  "Hämeenlinna", HML: "Hämeenlinna", IK:  "Ikaalinen",
  SK:  "Salo",        IMR: "Imatra",      JNS2:"Joensuu",
  KAJ2:"Kajaani",     YV:  "Ylivieska",   KEM2:"Kemi",
  TKU2:"Turku satama",ESP: "Espoo",       LEN: "Lentoasema",
  HPL: "Helsinki-Vantaan lentoasema", HVL: "Lentoasema",
};

interface FintrafficTimeTableRow {
  stationShortCode: string;
  type: "ARRIVAL" | "DEPARTURE";
  scheduledTime: string;
  liveEstimateTime?: string;
  actualTime?: string;
  differenceInMinutes?: number;
  cancelled: boolean;
}

interface FintrafficTrain {
  trainNumber: number;
  trainType: string;
  trainCategory: string;
  commuterLineID?: string;
  cancelled: boolean;
  timeTableRows: FintrafficTimeTableRow[];
}

/**
 * Tarkistaa onko nyt ruuhka-aika, jolloin lentokenttäjunat (I/P) ovat
 * relevantteja taksikuljettajille:
 *  - iltapäivä klo 16:00 - 17:30 (työmatkalaiset menevät kentälle)
 *  - ilta klo 23:00 - 00:30 (myöhäiset saapumiset, vähän bussiyhteyksiä)
 * Aikavyöhyke: Europe/Helsinki.
 */
function isCommuterRushHour(): boolean {
  const now = new Date();
  // Käytetään Helsingin aikaa
  const hkiTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Helsinki" }));
  const h = hkiTime.getHours();
  const m = hkiTime.getMinutes();
  const totalMin = h * 60 + m;
  // 16:00 - 17:30
  if (totalMin >= 16 * 60 && totalMin <= 17 * 60 + 30) return true;
  // 23:00 - 00:30 (käsittele yli puolenyön)
  if (totalMin >= 23 * 60) return true;
  if (totalMin <= 30) return true;
  return false;
}

/**
 * Hakee junan lahtöaseman: ensimmainen DEPARTURE-rivi aikataulussa.
 * Kayttaa STATION_NAMES-mappingia selkokieliseen nimeen.
 */
function getOriginStation(rows: FintrafficTimeTableRow[]): string {
  // Jarjesta aikataulun mukaan (scheduledTime nouseva)
  const sorted = [...rows].sort(
    (a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
  );
  const first = sorted.find((r) => r.type === "DEPARTURE");
  if (!first) return "Tuntematon";
  const code = first.stationShortCode;
  // Älä koskaan palauta pelkkää lyhennettä — jos mappausta ei löydy,
  // näytä lyhenne sulkeissa ja "Asema" -etuliite, jotta käyttäjä tietää
  // että kyseessä on tunnistamaton asemakoodi.
  return STATION_NAMES[code] ?? `Asema ${code}`;
}

/**
 * Tarkistaa onko juna Helsinki-suuntainen:
 * Junan aikatauluriveilta loytyy ARRIVAL HKI-asemalle.
 * Toimii oikein myos PSL/TKL-valiasemilla.
 */
function isHelsinkiBound(rows: FintrafficTimeTableRow[]): boolean {
  return rows.some(
    (r) => r.type === "ARRIVAL" && r.stationShortCode === "HKI"
  );
}

/**
 * Tarkistaa onko juna matkalla kohti Helsinkia valitulta asemalta katsoen.
 * PSL/TKL ovat valiasemia: junat voivat kulkea molempiin suuntiin.
 * Hyvaksytaan vain junat, joissa HKI ARRIVAL tapahtuu valitun aseman
 * ARRIVAL-rivin JALKEEN aikataulussa (eli juna on tulossa Helsinkiin).
 */
function isHeadingToHelsinki(
  rows: FintrafficTimeTableRow[],
  station: TrainStation
): boolean {
  if (station === "HKI") {
    return rows.some((r) => r.type === "ARRIVAL" && r.stationShortCode === "HKI");
  }
  // Etsi junan ENSIMMAINEN lahto (origin) ja VIIMEINEN saapuminen (destination)
  // aikataulun mukaan jarjestettyna.
  const sorted = [...rows].sort(
    (a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
  );
  const firstDeparture = sorted.find((r) => r.type === "DEPARTURE");
  const lastArrival = [...sorted].reverse().find((r) => r.type === "ARRIVAL");
  if (!firstDeparture || !lastArrival) return false;
  // Helsinki-suuntainen = paatepysakki on HKI, EIKA juna lahde Helsingista
  return lastArrival.stationShortCode === "HKI" && firstDeparture.stationShortCode !== "HKI";
}

/**
 * Hakee reaaliaikaiset kaukojunat valitulle asemalle.
 * Palauttaa vain myohastyneet tai pian saapuvat junat.
 *
 * @param station - Asemakoodi: HKI | PSL | TKL
 * @returns TrainDelay[] jarjestettyna saapumisajan mukaan
 */
export async function fetchLiveTrains(station: TrainStation = "HKI"): Promise<TrainDelay[]> {
  const res = await fetch(getFintrafficUrl(station), {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Fintraffic API error: ${res.status} ${res.statusText}`);
  }

  const trains: FintrafficTrain[] = await res.json();

  const results: TrainDelay[] = [];

  for (const train of trains) {
    if (train.cancelled) continue;

    // Lentokenttäjunat (commuter I/P) ovat relevantteja vain ruuhka-aikoina
    const isAirport =
      train.trainCategory === "Commuter" &&
      (train.commuterLineID === "I" || train.commuterLineID === "P");

    // Hyväksy kaukojunat aina, lentokenttäjunat vain ruuhka-aikoina
    if (train.trainCategory !== "Long-distance" && !(isAirport && isCommuterRushHour())) {
      continue;
    }

    // Naytetaan vain Helsinki-suuntaiset junat kaikilla asemilla (HKI/PSL/TKL).
    // Helsingista lahtevat junat (esim. PSL nakee HKI->TPE junan "saapuvana")
    // suodatetaan pois, koska niiden matkustajat eivat ole taksiasiakkaita.
    if (!isHeadingToHelsinki(train.timeTableRows, station)) {
      continue;
    }

    // Loyda saapumisrivi valitulle asemalle
    const arrival = train.timeTableRows.find(
      (r) => r.stationShortCode === station && r.type === "ARRIVAL"
    );
    if (!arrival) continue;

    // VAIN saapuvat seuraavan tunnin sisalla:
    // - ohita jos saapuminen on jo mennyt (yli 2 min sitten)
    // - ohita jos saapuminen on yli 60 min paassa
    const arrivalEpoch = new Date(
      arrival.liveEstimateTime ?? arrival.actualTime ?? arrival.scheduledTime
    ).getTime();
    const now = Date.now();
    if (arrivalEpoch < now - 2 * 60 * 1000) continue;
    if (arrivalEpoch > now + 60 * 60 * 1000) continue;

    // Laske viive: kayta liveEstimate > actualTime > scheduled
    const scheduled = new Date(arrival.scheduledTime);
    const estimate =
      arrival.liveEstimateTime
        ? new Date(arrival.liveEstimateTime)
        : arrival.actualTime
        ? new Date(arrival.actualTime)
        : scheduled;

    const delayMinutes = Math.max(
      0,
      Math.round((estimate.getTime() - scheduled.getTime()) / 60000)
    );

    // Muotoile saapumisaika HH:MM
    const arrivalTime =
      estimate.getHours().toString().padStart(2, "0") +
      ":" +
      estimate.getMinutes().toString().padStart(2, "0");

    // Lentokenttäjunille korvaa origin-teksti selkeämmäksi
    const origin = isAirport
      ? "Lentoasema"
      : getOriginStation(train.timeTableRows);

    results.push({
      id: `fin-${train.trainNumber}`,
      line: `${train.trainType} ${train.trainNumber}`,
      origin,
      delayMinutes,
      arrivalTime,
    } satisfies TrainDelay);
  }

  // Jarjesta saapumisajan mukaan (aikaisin ensin)
  const byTime = (a: TrainDelay, b: TrainDelay) => {
    const [ah, am] = a.arrivalTime.split(":").map(Number);
    const [bh, bm] = b.arrivalTime.split(":").map(Number);
    return ah * 60 + am - (bh * 60 + bm);
  };
  results.sort(byTime);

  // Priorisoi kaukojunat: lentoasemajunat (HL/origin "Lentoasema") tayttavat
  // ruuhka-aikana koko listan. Otetaan ensin enintaan 4 kaukojunaa,
  // sitten taytetaan max 1 lentoasemajunalla -> yhteensa max 5.
  const longDistance = results.filter((t) => t.origin !== "Lentoasema");
  const airport = results.filter((t) => t.origin === "Lentoasema");
  const topTrains = [...longDistance.slice(0, 4), ...airport.slice(0, 1)]
    .sort(byTime)
    .slice(0, 5);

  // Hae compositions top-3 lähimmälle junalle
  const top3 = topTrains.slice(0, 3);
  const today = new Date().toISOString().split("T")[0];
  const seatResults = await Promise.allSettled(
    top3.map((t) =>
      fetchTrainSeats(Number(t.id.replace(/^fin-/, "")), today)
    )
  );
  seatResults.forEach((result, i) => {
    if (result.status === "fulfilled" && result.value !== null) {
      top3[i].capacity = result.value;
      top3[i].capacitySource = "real";
    } else {
      top3[i].capacity = getTypeCapacity(top3[i].line);
      top3[i].capacitySource = "estimate";
    }
  });

  // Muille junille tyyppiarvio
  topTrains.slice(3).forEach((t) => {
    t.capacity = getTypeCapacity(t.line);
    t.capacitySource = "estimate";
  });

  return topTrains;
}
