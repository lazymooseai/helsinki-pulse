/**
 * scan-prebookings
 *
 * Lukee kuvan / PDF:n ennakkotilauslistasta ja palauttaa listan
 * { tolppa, pickup_at } -objekteja Geminin avulla.
 *
 * Input:
 *   { image: "data:image/jpeg;base64,..." }
 *   { pdf:   "data:application/pdf;base64,..." }
 *   (valinnainen) { reference_date: "2026-04-26" } — auttaa Geminia paattamaan vuoden/paivan
 *
 * Output: { bookings: Array<{ tolppa, pickup_at, confidence, raw }> , raw_text }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Olet taksin valityslaitteen ennakkotilauslistan lukija.
Listassa nakyy ennakkoon varattuja kyyteja: jokaisella on noutoaika ja noutopaikka (tolppa tai osoite/alue).

Palauta KAIKKI listalta loytyvat ennakkotilaukset listana. Jokaiselle:
- tolppa: noutopaikan nimi (tolppa, osoite, kohde tai alue) — pakollinen
- pickup_at: noutoaika ISO 8601 -muodossa (esim. "2026-04-26T14:30:00+03:00")
  - Suomen aikavyohyke (Europe/Helsinki, +03:00 kesalla, +02:00 talvella)
  - Jos paivamaaraa ei nay, kayta annettua reference_date -arvoa (oletus: tanaan)
  - Jos vain kellonaika nakyy, kayta seuraavaa esiintymaa siita ajasta
- confidence: 0..1

Anna myos overall_confidence ja raw_text (kaikki teksti).`;

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    bookings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          tolppa: { type: "STRING" },
          pickup_at: { type: "STRING", description: "ISO 8601 + Helsinki TZ" },
          confidence: { type: "NUMBER" },
        },
        required: ["tolppa", "pickup_at"],
      },
    },
    overall_confidence: { type: "NUMBER" },
    raw_text: { type: "STRING" },
  },
  required: ["bookings"],
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY puuttuu" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const payload: string | undefined = body.image ?? body.pdf;
    const referenceDate: string =
      typeof body.reference_date === "string"
        ? body.reference_date
        : new Date().toISOString().slice(0, 10);

    if (!payload || typeof payload !== "string" || !payload.startsWith("data:")) {
      return new Response(
        JSON.stringify({ error: "image tai pdf on pakollinen (data:...;base64,...)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const match = payload.match(/^data:([a-zA-Z0-9+.\/-]+);base64,(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "Virheellinen data URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mimeType = match[1];
    const base64Data = match[2];

    const SUPPORTED_MIMES = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heif",
      "application/pdf",
    ];
    if (!SUPPORTED_MIMES.includes(mimeType)) {
      return new Response(
        JSON.stringify({
          error: `Tyyppi ${mimeType} ei ole tuettu. Kayta JPEG/PNG/WEBP tai PDF.`,
        }),
        {
          status: 415,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const isPdf = mimeType === "application/pdf";

    const aiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Reference date: ${referenceDate} (Europe/Helsinki). Lue ${
                  isPdf ? "PDF" : "kuva"
                } ja palauta KAIKKI ennakkotilaukset.`,
              },
              { inlineData: { mimeType, data: base64Data } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({
            error:
              "Gemini-rate-limit ylittyi (ilmainen taso: ~10/min, 250/pv). Yrita hetken paasta.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (aiRes.status === 401 || aiRes.status === 403) {
        return new Response(
          JSON.stringify({ error: "GEMINI_API_KEY virheellinen tai ei oikeuksia" }),
          {
            status: aiRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const txt = await aiRes.text();
      console.error("Gemini API error", aiRes.status, txt);
      return new Response(JSON.stringify({ error: "AI-luenta epaonnistui" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) {
      console.error("Ei JSON-vastausta", JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: "AI ei pystynyt lukemaan tiedostoa" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(jsonText);
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-prebookings virhe:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "tuntematon virhe" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});