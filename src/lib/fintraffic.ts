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
  OL:  "Oulu",       TPE: "Tampere",    TKU: "Turku",
  JY:  "Jyvaskyla",  KUO: "Kuopio",     JNS: "Joensuu",
  ROI: "Rovaniemi",  KEM: "Kemi",       SEI: "Seinajoki",
  LR:  "Lahti",      KOK: "Kokkola",    MI:  "Mikkeli",
  PM:  "Pieksamaki", VNS: "Vaasa",      KAJ: "Kajaani",
  LI:  "Lappeenranta", RI: "Riihimaki", HKI: "Helsinki",
  PSL: "Pasila",     TKL: "Tikkurila",  KV:  "Kouvola",
  HML: "Hameenlinna", IK: "Ikaalinen",  SK:  "Salo",
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
  cancelled: boolean;
  timeTableRows: FintrafficTimeTableRow[];
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
  return STATION_NAMES[first.stationShortCode] ?? first.stationShortCode;
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
    // Suodata: vain kaukojunat, ei peruutettuja
    if (train.trainCategory !== "Long-distance" || train.cancelled) {
      continue;
    }
    // HKI-asemalla naytetaan vain Helsinkiin saapuvat (paateaseman saapumiset).
    // PSL/TKL ovat valiasemia: kaikki kaukojunien pysahdykset ovat relevantteja
    // taksikuljettajalle (sek. Helsinkiin saapuvat etta Helsingista lahtevat).
    if (station === "HKI" && !isHelsinkiBound(train.timeTableRows)) {
      continue;
    }

    // Loyda saapumisrivi valitulle asemalle
    const arrival = train.timeTableRows.find(
      (r) => r.stationShortCode === station && r.type === "ARRIVAL"
    );
    if (!arrival) continue;

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

    results.push({
      id: `fin-${train.trainNumber}`,
      line: `${train.trainType} ${train.trainNumber}`,
      origin: getOriginStation(train.timeTableRows),
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
