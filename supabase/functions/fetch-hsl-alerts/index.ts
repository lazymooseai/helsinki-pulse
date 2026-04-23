/**
 * fetch-hsl-alerts/index.ts
 *
 * HSL liikennehairiohaku Supabase Edge Functionina.
 *
 * Kayttaa pelkastaan HSL:n avointa REST API:a (ei vaadi avaimia).
 * Yksityinen Digitransit-avain on poistettu, koska tama endpoint on julkinen
 * eika sita voi suojata kayttajakohtaisella JWT:lla (sovelluksessa ei ole
 * autentikointia). Avaimellinen reitti olisi mahdollistanut kvootin abuusen.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ParsedAlert {
  id: string;
  alertHeaderText: string;
  alertDescriptionText: string;
  alertSeverityLevel: string;
  effectiveStartDate: number;
  effectiveEndDate: number;
}

// ---------------------------------------------------------------------------
// HSL avoin REST API (service-alerts) - ei vaadi avainta
// ---------------------------------------------------------------------------

async function fetchViaHslOpenApi(): Promise<ParsedAlert[]> {
  // HSL tarjoaa hairiot myos yksinkertaisena JSON-endpointina
  const res = await fetch(
    "https://api.hsl.fi/v1/disruptions?lang=fi",
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!res.ok) {
    throw new Error(`HSL Open API error: ${res.status}`);
  }

  const disruptions = await res.json();

  // HSL disruptions API rakenne: array of { id, title, description, validFrom, validTo }
  if (!Array.isArray(disruptions)) return [];

  const now = Math.floor(Date.now() / 1000);

  return disruptions
    .filter((d: any) => {
      // Suodata vain aktiiviset hairiot
      const end = d.validTo ? Math.floor(new Date(d.validTo).getTime() / 1000) : now + 3600;
      return end > now;
    })
    .map((d: any, i: number) => ({
      id: d.id || `hsl-open-${i}`,
      alertHeaderText: d.title?.fi || d.title?.en || "HSL-hairio",
      alertDescriptionText: d.description?.fi || d.description?.en || "",
      alertSeverityLevel: d.severity || "WARNING",
      effectiveStartDate: d.validFrom
        ? Math.floor(new Date(d.validFrom).getTime() / 1000)
        : now,
      effectiveEndDate: d.validTo
        ? Math.floor(new Date(d.validTo).getTime() / 1000)
        : now + 3600,
    }));
}

// ---------------------------------------------------------------------------
// Paafunktio
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let alerts: ParsedAlert[] = [];

    try {
      alerts = await fetchViaHslOpenApi();
      console.log(`HSL Open API: ${alerts.length} hairioita`);
    } catch (e) {
      console.warn("HSL Open API epaonnistui:", e);
    }

    // Suodata vanhat hairiot pois
    const now = Math.floor(Date.now() / 1000);
    const activeAlerts = alerts.filter(
      (a) => !a.effectiveEndDate || a.effectiveEndDate > now
    );

    return new Response(
      JSON.stringify({
        alerts: activeAlerts,
        source: "hsl-open-api",
        count: activeAlerts.length,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("HSL alerts proxy error:", err);
    // Ei kaadu - palauttaa tyhjan listan
    return new Response(
      JSON.stringify({
        alerts: [],
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200, // 200 eika 500 - frontend toimii ilman hairioita
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
