/**
 * flights.ts
 *
 * Hakee Helsinki-Vantaan saapuvat lennot (seuraavat 3h) edge functionin kautta.
 * Edge function käyttää Finavia API:a ja vaatii FINAVIA_API_KEY-secretin.
 */

import { supabase } from "@/integrations/supabase/client";
import type { FlightArrival } from "./types";

interface FlightsResponse {
  flights: FlightArrival[];
  count: number;
  source: string;
  timestamp: string;
}

const WINDOW_LOWER_MIN = -5;
const WINDOW_UPPER_MIN = 180;

function minutesUntilArrival(timeStr: string): number {
  if (!timeStr) return 999;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return 999;
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  let diff = (target.getTime() - now.getTime()) / 60000;
  if (diff < -60) diff += 1440;   // overnight: add 24h
  if (diff > 1200) diff -= 1440;  // edge case: subtract 24h
  return Math.round(diff);
}

export async function fetchFlightArrivals(): Promise<FlightArrival[]> {
  try {
    const { data, error } = await supabase.functions.invoke<FlightsResponse>(
      "fetch-flights",
      { body: {} }
    );

    if (error) {
      console.warn("fetch-flights edge function virhe:", error.message);
      return [];
    }

    const flights = data?.flights ?? [];

    // Suodatus: käytä estimatedTime-aikaa (fallback scheduledTime)
    // jotta viivästyneet lennot eivät putoa ikkunasta.
    return flights.filter((f) => {
      const refTime = f.estimatedTime || f.scheduledTime;
      const mins = minutesUntilArrival(refTime);
      return mins >= WINDOW_LOWER_MIN && mins <= WINDOW_UPPER_MIN;
    });
  } catch (err) {
    console.warn("fetchFlightArrivals epaonnistui:", err);
    return [];
  }
}
