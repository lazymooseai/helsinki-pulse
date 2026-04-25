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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY puuttuu" }), {
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

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Lue luvut talta valityslaitteen naytön kuvalta." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_dispatch_numbers",
              description: "Palauttaa naytölta luetut K/T-luvut.",
              parameters: {
                type: "object",
                properties: {
                  tolppa: { type: "string", description: "Tolpan nimi suomeksi" },
                  k_now: { type: ["integer", "null"], description: "K+ kysynta nyt" },
                  t_now: { type: ["integer", "null"], description: "T+ tarjonta nyt" },
                  k_30: { type: ["integer", "null"], description: "K-30 kysynta 30min" },
                  t_30: { type: ["integer", "null"], description: "T-30 tarjonta 30min" },
                  confidence: { type: "number", description: "0..1" },
                  raw_text: { type: "string", description: "Kaikki kuvasta luettu teksti" },
                },
                required: ["tolppa", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_dispatch_numbers" } },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "AI-rate-limit ylittyi, yrita hetken paasta uudelleen" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "Lovable AI -krediitit loppu, lisaa workspaceen" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const txt = await aiRes.text();
      console.error("AI gateway error", aiRes.status, txt);
      return new Response(JSON.stringify({ error: "AI-luenta epaonnistui" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("Ei tool_callia vastauksessa", JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: "AI ei pystynyt lukemaan kuvaa" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(toolCall.function.arguments);
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