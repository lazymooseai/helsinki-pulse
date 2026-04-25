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

async function fetchViaDigitransit(): Promise<ParsedAlert[]> {
  // Digitransit GraphQL - hsl router. Toimii ilman avainta julkisille kyselyille,
  // mutta voi rate-limitata. Jos pettaa, palautamme tyhjan listan.
  const query = `{
    alerts(feeds: ["HSL"]) {
      id
      alertHeaderText
      alertDescriptionText
      alertSeverityLevel
      effectiveStartDate
      effectiveEndDate
    }
  }`;

  const res = await fetch(
    "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!res.ok) {
    throw new Error(`Digitransit error: ${res.status}`);
  }

  const json = await res.json();
  const alerts = json?.data?.alerts ?? [];
  if (!Array.isArray(alerts)) return [];

  return alerts.map((a: any, i: number) => ({
    id: a.id || `hsl-${i}`,
    alertHeaderText: a.alertHeaderText || "HSL-hairio",
    alertDescriptionText: a.alertDescriptionText || "",
    alertSeverityLevel: a.alertSeverityLevel || "WARNING",
    effectiveStartDate: a.effectiveStartDate || 0,
    effectiveEndDate: a.effectiveEndDate || 0,
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
      alerts = await fetchViaDigitransit();
      console.log(`Digitransit: ${alerts.length} hairioita`);
    } catch (e) {
      console.warn("Digitransit epaonnistui:", e instanceof Error ? e.message : e);
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
