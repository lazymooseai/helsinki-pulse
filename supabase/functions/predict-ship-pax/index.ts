import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PredictRequest {
  ship: string;
  terminal: string;
  arrival_time: string; // ISO
}

interface HistoryRow {
  pax: number;
  arrival_time: string;
  day_of_week: number | null;
  hour_of_day: number | null;
  weather_code: number | null;
  temperature_c: number | null;
}

function summarizeHistory(rows: HistoryRow[]) {
  if (rows.length === 0) return null;
  const paxArr = rows.map(r => r.pax).filter(p => p > 0);
  if (paxArr.length === 0) return null;
  const avg = paxArr.reduce((a, b) => a + b, 0) / paxArr.length;
  const min = Math.min(...paxArr);
  const max = Math.max(...paxArr);
  const sorted = [...paxArr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { avg: Math.round(avg), median, min, max, count: paxArr.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as PredictRequest;
    if (!body?.ship || !body?.arrival_time) {
      return new Response(JSON.stringify({ error: 'ship ja arrival_time vaaditaan' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const lovableKey  = Deno.env.get('LOVABLE_API_KEY') ?? '';
    const sb = createClient(supabaseUrl, serviceKey);

    const target = new Date(body.arrival_time);
    const dow = ((target.getDay() + 6) % 7) + 1;
    const hour = target.getHours();

    // 1) Hae historia samalle laivalle
    const { data: shipHistory } = await sb
      .from('ship_pax_history')
      .select('pax, arrival_time, day_of_week, hour_of_day, weather_code, temperature_c')
      .eq('ship', body.ship)
      .order('arrival_time', { ascending: false })
      .limit(200);

    // 2) Hae historia samalle viikonpäivä+tunti -kombolle (kaikki laivat samalla terminaalilla)
    const { data: dowHourHistory } = await sb
      .from('ship_pax_history')
      .select('pax, arrival_time, day_of_week, hour_of_day, weather_code, temperature_c')
      .eq('terminal', body.terminal)
      .eq('day_of_week', dow)
      .gte('hour_of_day', Math.max(0, hour - 1))
      .lte('hour_of_day', Math.min(23, hour + 1))
      .limit(100);

    const shipStats = summarizeHistory((shipHistory ?? []) as HistoryRow[]);
    const slotStats = summarizeHistory((dowHourHistory ?? []) as HistoryRow[]);

    // 3) Sää
    let weatherCode: number | null = null;
    let temperatureC: number | null = null;
    try {
      const wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=60.17&longitude=24.94&current=temperature_2m,weather_code&timezone=Europe%2FHelsinki');
      if (wRes.ok) {
        const w = await wRes.json();
        weatherCode  = w?.current?.weather_code ?? null;
        temperatureC = w?.current?.temperature_2m ?? null;
      }
    } catch (_) { /* ignore */ }

    // 4) Baseline: jos historiaa ei ole, palautetaan slot-keskiarvo tai null
    let predicted = shipStats?.median ?? slotStats?.median ?? 0;
    let reasoning = `Baseline: laivan mediaani ${shipStats?.median ?? '-'}, slot-mediaani ${slotStats?.median ?? '-'} (n=${shipStats?.count ?? 0}/${slotStats?.count ?? 0}).`;
    let model = 'baseline-median';

    // 5) Jos LOVABLE_API_KEY ja riittävästi dataa -> kysy AI:lta
    if (lovableKey && (shipStats || slotStats)) {
      try {
        const sysPrompt = `Olet matkustaja-analyytikko Helsingin satamalle. Ennusta laivan saapuvien matkustajien määrä (kokonaisluku) annetun historian ja kontekstin perusteella. Vastaa pelkän työkalun kautta.`;
        const userPrompt = JSON.stringify({
          ship: body.ship,
          terminal: body.terminal,
          arrival_time: body.arrival_time,
          day_of_week: dow,
          hour_of_day: hour,
          weather_code: weatherCode,
          temperature_c: temperatureC,
          ship_history_stats: shipStats,
          terminal_dow_hour_stats: slotStats,
          recent_ship_observations: (shipHistory ?? []).slice(0, 20),
        });

        const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${lovableKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-3-flash-preview',
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userPrompt },
            ],
            tools: [{
              type: 'function',
              function: {
                name: 'submit_pax_prediction',
                description: 'Palauta matkustajamäärän ennuste',
                parameters: {
                  type: 'object',
                  properties: {
                    predicted_pax: { type: 'integer', description: 'Ennustettu matkustajamäärä' },
                    reasoning: { type: 'string', description: 'Lyhyt suomenkielinen perustelu' },
                  },
                  required: ['predicted_pax', 'reasoning'],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'submit_pax_prediction' } },
          }),
        });

        if (aiRes.ok) {
          const data = await aiRes.json();
          const call = data?.choices?.[0]?.message?.tool_calls?.[0];
          if (call?.function?.arguments) {
            const args = JSON.parse(call.function.arguments);
            if (Number.isFinite(args.predicted_pax)) {
              predicted = Math.max(0, Math.round(args.predicted_pax));
              reasoning = args.reasoning ?? reasoning;
              model = 'gemini-3-flash-preview';
            }
          }
        } else if (aiRes.status === 429 || aiRes.status === 402) {
          console.warn('AI gateway rajoitus:', aiRes.status);
        }
      } catch (e) {
        console.warn('AI-ennuste epaonnistui, kaytetaan baselinea:', (e as Error).message);
      }
    }

    // 6) Tallenna ennuste
    const features = {
      day_of_week: dow,
      hour_of_day: hour,
      weather_code: weatherCode,
      temperature_c: temperatureC,
      ship_history_stats: shipStats,
      slot_stats: slotStats,
    };

    const { error: upErr } = await sb
      .from('ship_pax_predictions')
      .upsert({
        ship: body.ship,
        terminal: body.terminal,
        arrival_time: target.toISOString(),
        predicted_pax: predicted,
        model,
        reasoning,
        features,
      }, { onConflict: 'ship,arrival_time,model' });
    if (upErr) console.warn('predictions upsert virhe:', upErr.message);

    return new Response(JSON.stringify({
      ship: body.ship,
      terminal: body.terminal,
      arrival_time: target.toISOString(),
      predicted_pax: predicted,
      model,
      reasoning,
      features,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('predict-ship-pax virhe:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});