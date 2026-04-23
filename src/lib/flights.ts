/**
 * flights.ts
 *
 * Hakee Helsinki-Vantaan saapuvat lennot (seuraavat 2h) edge functionin kautta.
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

    return data?.flights ?? [];
  } catch (err) {
    console.warn("fetchFlightArrivals epaonnistui:", err);
    return [];
  }
}
