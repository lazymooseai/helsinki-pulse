import { ShipArrival, HarborPaxResponse, AverioShip } from "./types";
import { supabase } from "@/integrations/supabase/client";

export async function fetchHarborPaxEstimates(): Promise<HarborPaxResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-harbor-pax');
    if (error) {
      console.warn('Harbor pax edge function virhe (kaytetaan tyhjaa fallbackia):', error.message);
      return { estimates: {}, ships: [], source: 'fallback', timestamp: new Date().toISOString() } as HarborPaxResponse;
    }
    // Edge function voi palauttaa { fallback: true } 5xx-tilanteissa
    if (data && (data as { fallback?: boolean }).fallback) {
      return { estimates: {}, ships: [], source: 'fallback', timestamp: new Date().toISOString() } as HarborPaxResponse;
    }
    return data as HarborPaxResponse;
  } catch (e) {
    console.warn('Harbor pax fetch poikkeus:', e);
    return { estimates: {}, ships: [], source: 'fallback', timestamp: new Date().toISOString() } as HarborPaxResponse;
  }
}

/** Convert Averio arrival time "HH:MM DD.MM.YYYY" to just "HH:MM" */
function parseAverioTime(arrivalTime: string): string {
  const parts = arrivalTime.split(' ');
  return parts[0] || arrivalTime;
}

/** Convert Averio ships to ShipArrival[], filtering to upcoming 3h window */
export function averioShipsToArrivals(ships: AverioShip[]): ShipArrival[] {
  const now = new Date();
  const results: ShipArrival[] = [];

  for (const s of ships) {
    const timePart = parseAverioTime(s.arrivalTime);
    const [hours, minutes] = timePart.split(':').map(Number);

    // Parse full date if available
    const dateParts = s.arrivalTime.split(' ');
    let arrivalDate: Date;
    if (dateParts.length >= 2) {
      const [day, month, year] = dateParts[1].split('.').map(Number);
      arrivalDate = new Date(year, month - 1, day, hours, minutes, 0);
    } else {
      arrivalDate = new Date(now);
      arrivalDate.setHours(hours, minutes, 0, 0);
    }

    const diffMin = (arrivalDate.getTime() - now.getTime()) / 60000;

    // Nayta vain laivat jotka saapuvat seuraavan 3h sisalla.
    // Saapuneet laivat (diffMin < 0) piilotetaan heti — matkustajat ovat jo poistuneet.
    if (diffMin >= 0 && diffMin <= 180) {
      results.push({
        id: `averio-${s.ship}-${timePart}`,
        ship: s.ship,
        harbor: s.harbor,
        pax: s.pax > 0 ? s.pax : 0,
        estimatedPax: s.pax > 0 ? s.pax : undefined,
        eta: timePart,
      });
    }
  }

  results.sort((a, b) => {
    const aMin = timeToMinutes(a.eta);
    const bMin = timeToMinutes(b.eta);
    return aMin - bMin;
  });

  return results;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
