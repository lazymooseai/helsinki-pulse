/**
 * scan-dispatch
 *
 * Lukee Taksi Helsinki -valityslaitteen naytön kuvan ja palauttaa
 * K+/T+/K-30/T-30 luvut tolppakohtaisesti.
 *
 * Input: { image: "data:image/jpeg;base64,..." }
 * Output: { tolppa, k_now, t_now, k_30, t_30, ocr_confidence, raw_text }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Olet Taksi Helsinki -valityslaitteen naytön lukija. Kuvassa nakyy taksitolpan tilanne nelja lukuna:
- K+ (kysynta nyt) = tilauksia jonossa juuri nyt
- T+ (tarjonta nyt) = vapaita autoja jonossa juuri nyt
- K-30 (kysynta 30 min) = tilausennuste seuraavalle 30 min
- T-30 (tarjonta 30 min) = autotarjonta-ennuste seuraavalle 30 min

Kuvassa nakyy myös tolpan nimi (esim. "Rautatientori", "Kamppi", "Pasilan asema").

Lue numerot tarkasti. Jos jotain lukua ei nay tai et ole varma, jata se nulliksi.
Tolpan nimi on aina pakollinen — jos et nae sita, kayta "Tuntematon".
Anna confidence 0..1 sen mukaan kuinka selkeasti nait luvut.`;

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    tolppa: { type: "STRING", description: "Tolpan nimi suomeksi" },
    k_now: { type: "INTEGER", nullable: true, description: "K+ kysynta nyt" },
    t_now: { type: "INTEGER", nullable: true, description: "T+ tarjonta nyt" },
    k_30: { type: "INTEGER", nullable: true, description: "K-30 kysynta 30min" },
    t_30: { type: "INTEGER", nullable: true, description: "T-30 tarjonta 30min" },
    confidence: { type: "NUMBER", description: "0..1" },
    raw_text: { type: "STRING", description: "Kaikki kuvasta luettu teksti" },
  },
  required: ["tolppa", "confidence"],
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

    const { image } = await req.json();
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return new Response(JSON.stringify({ error: "image on pakollinen (data:image/...;base64,...)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Erota mime + base64 data:image/jpeg;base64,XXXX -muodosta
    const match = image.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "Virheellinen data URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mimeType = match[1];
    const base64Data = match[2];

    const aiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              { text: "Lue luvut talta valityslaitteen naytön kuvalta." },
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
        return new Response(JSON.stringify({ error: "Gemini-rate-limit ylittyi (ilmainen taso: ~10/min, 250/pv). Yrita hetken paasta." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 401 || aiRes.status === 403) {
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY virheellinen tai ei oikeuksia" }), {
          status: aiRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
      return new Response(JSON.stringify({ error: "AI ei pystynyt lukemaan kuvaa" }), {
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
    console.error("scan-dispatch virhe:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "tuntematon virhe" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});