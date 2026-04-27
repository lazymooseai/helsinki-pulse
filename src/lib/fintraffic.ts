import { TrainDelay } from "./types";

export type TrainStation = "HKI" | "PSL" | "TKL";

export const TRAIN_STATIONS: { code: TrainStation; name: string }[] = [
  { code: "HKI", name: "Helsinki" },
  { code: "PSL", name: "Pasila" },
  { code: "TKL", name: "Tikkurila" },
];

// Nayta max 30 saapuvaa junaa - Long-distance suodatus karsii loput
function getFintrafficUrl(station: TrainStation): string {
  return (
    `https://rata.digitraffic.fi/api/v1/live-trains/station/${station}` +
    `?arrived_trains=3&arriving_trains=30&departing_trains=0&include_nonstopping=false`
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
  const stationArrival = rows.find(
    (r) => r.type === "ARRIVAL" && r.stationShortCode === station
  );
  const hkiArrival = rows.find(
    (r) => r.type === "ARRIVAL" && r.stationShortCode === "HKI"
  );
  if (!stationArrival || !hkiArrival) return false;
  // HKI saapumisajan tulee olla MYOHEMMIN kuin valitun aseman saapumisajan
  return (
    new Date(hkiArrival.scheduledTime).getTime() >
    new Date(stationArrival.scheduledTime).getTime()
  );
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

    // VAIN saapuvat: jos saapumisaika on jo mennyt (yli 2 min sitten), ohita.
    // Tämä estää Helsingistä juuri lähteneiden junien näyttämisen.
    const arrivalEpoch = new Date(
      arrival.liveEstimateTime ?? arrival.actualTime ?? arrival.scheduledTime
    ).getTime();
    if (arrivalEpoch < Date.now() - 2 * 60 * 1000) continue;

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
  results.sort((a, b) => {
    const [ah, am] = a.arrivalTime.split(":").map(Number);
    const [bh, bm] = b.arrivalTime.split(":").map(Number);
    return ah * 60 + am - (bh * 60 + bm);
  });

  return results;
}
