# Memory: index.md
Updated: now

# Project Memory

## Core
- High-contrast UI: bg-slate-900, massive text (4xl/5xl font-black), neon green/red. Finnish text. Optimize for arm's length driving.
- All interactive cards and control room items must open verified external deep links in new tabs.
- Use Supabase Edge Functions to proxy external APIs (Fintraffic, Open-Meteo, HSL, Finavia) to bypass CORS.
- Data freshness: display green 'LIVE' dot for recent, gray 'AIKATAULU' dot for stale (>30m). Pulse external link icon when stale.

## Memories
- [Visual Identity](mem://design/visual-identity) — High-contrast, ultra-legible dashboard UI for drivers (Finnish)
- [Jackpot Engine](mem://logic/jackpot-engine) — Logic for triggering high-value alerts based on delays, pax, and weather
- [Helsinki Live Data](mem://integrations/helsinki-live-data) — API integration rules for Fintraffic, Open-Meteo, MyHelsinki, and HSL
- [Recommendation System](mem://features/recommendation-system) — Command Center zone recommendation and driver feedback loop
- [Harbor Tracking](mem://features/harbor-tracking) — Helsinki ferry passenger tracking via averio.fi
- [Events Tracking](mem://features/events-tracking) — Helsinki events fetching, fallback events, and demand heuristics
- [Manual Overrides](mem://features/manual-overrides) — Driver manual event data overrides (Crowd Control, Dispatch Override)
- [Control Room Sources](mem://features/control-room-sources) — Master Data Library linking to verified external schedules and maps
- [Situational Awareness](mem://features/situational-awareness) — HSL alerts, traffic cameras, and emergency links
- [Interactive Data Cards](mem://features/interactive-data-cards) — Interactive links and freshness indicators on all data cards
- [Train Station Selector](mem://features/train-station-selector) — Toggles between HKI, PSL, TKL stations, filtered for HKI-bound traffic
- [Dispatch Scanner](mem://features/dispatch-scanner) — Camera + AI-OCR (Gemini 2.5 Flash) for Taksi Helsinki dispatch screen → live K/T per tolppa
- [Trip History](mem://features/trip-history) — taxi_trips & trip_patterns: tuonti (CSV/XLSX), manuaalinen syöttö, haku, analytiikkakortti
- [Real-Time Refresh](mem://features/real-time-refresh) — Per-source refresh intervals and visible countdown indicator on data tabs
- [Flights & Sports](mem://features/flights-sports) — HEL-Vantaa flight arrivals (Finavia) + sports events with teams/attendance
