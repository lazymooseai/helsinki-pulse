/**
 * types.ts
 *
 * Kaikki jaetut TypeScript-tyypit Helsinki Taxi Pulse -sovellukselle.
 * Muutokset tahan tiedostoon vaikuttavat koko sovellukseen.
 */

export interface TrainDelay {
  id: string;
  line: string;
  origin: string;
  delayMinutes: number;
  arrivalTime: string;
}

export interface ShipArrival {
  id: string;
  ship: string;
  harbor: string;
  pax: number;           // Maksimikapasiteetti
  estimatedPax?: number; // Live-estimaatti Averio/Port of Helsinki -lahteesta
  eta: string;
}

export interface EventInfo {
  id: string;
  name: string;
  venue: string;
  endsIn: number;         // Minuutteja paattymiseen
  soldOut: boolean;
  demandTag?: string;     // Kuljettajalle nakyvä tagi, esim. "KORKEA KYSYNTA"
  demandLevel?: "red" | "amber" | "green";
  startTime?: string;     // HH:MM muodossa
  endTime?: string;       // HH:MM muodossa - paattymisaika (purkuaika)
  capacity?: number;      // Venue-kapasiteetti (paikkamäärä)
  estimatedAttendance?: number; // Arvio yleisömäärästä
  loadFactor?: number;    // 0..1 - lipunmyyntiaste
  availabilityNote?: string; // Vapaa kuvaus tilanteesta tai AI-arvion peruste
}

export interface WeatherData {
  condition: "Rain" | "Clear" | "Snow";
  temp: number;           // Lampotila celsiuksina (pyoristetty)
  rain: number;           // Sademäärä mm/h
  showers: number;        // Sadekuurot mm/h
  snowfall: number;       // Lumisade mm/h
  windSpeed: number;      // Tuulennopeus m/s
  rainModeActive: boolean; // true kun sade+lumi > 1.0 mm/h
  slipperyIndex?: number;  // 0.0-1.0: liukkausindeksi (>= 0.6 = sairaala-signaali)
}

export type AlertLevel = "none" | "high" | "jackpot";

export interface JackpotAlert {
  level: AlertLevel;
  zone: string;
  reason: string;
  type: "train" | "ship" | "weather" | "combined" | "event";
}

export interface FlightArrival {
  id: string;
  flightNumber: string;       // "AY1234"
  airline: string;
  origin: string;             // Koko nimi tai IATA
  originCode: string;         // IATA-koodi "ARN"
  scheduledTime: string;      // HH:MM
  estimatedTime: string;      // HH:MM
  delayMinutes: number;
  terminal?: string;          // "T1" / "T2"
  gate?: string;
  belt?: string;
  status: string;
  demandTag: string;
  demandLevel: "red" | "amber" | "green";
}

export interface SportsEvent {
  id: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  startTime: string;          // HH:MM
  expectedAttendance: number;
  capacity: number;
  league: string;             // "Liiga", "Veikkausliiga", "NHL preseason" jne.
  endsIn: number;             // Min ennen päättymistä (negatiivinen jos jo loppunut)
  demandTag: string;
  demandLevel: "red" | "amber" | "green";
}

export interface DashboardState {
  trainDelays: TrainDelay[];
  shipArrivals: ShipArrival[];
  events: EventInfo[];
  weather: WeatherData;
  flights: FlightArrival[];
  sportsEvents: SportsEvent[];
}

export interface UpcomingEvents {
  list: EventInfo[];
}

export interface HarborPaxEstimate {
  estimate: number;
  maxCapacity: number;
  factor: number;        // Tayttoprosentti 0-100
}

export interface AverioShip {
  ship: string;
  harbor: string;
  pax: number;
  arrivalTime: string;
}

export interface HarborPaxResponse {
  estimates: Record<string, HarborPaxEstimate>;
  ships: AverioShip[];
  source: string;
  timestamp: string;
}
