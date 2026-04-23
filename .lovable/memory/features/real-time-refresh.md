---
name: Real-Time Refresh Cadence
description: Per-source refresh intervals and visible countdown indicator on data tabs
type: feature
---

## Refresh intervals (DashboardContext)

- **Trains (Fintraffic)**: `TRAIN_REFRESH_MS = 2 * 60 * 1000` — separate `refreshTrains()` function, only updates `state.trainDelays` and `sourceTimestamps.trains`
- **Ships, weather, events**: `OTHERS_REFRESH_MS = 5 * 60 * 1000` — handled by `refreshAll()` together with trains
- Both intervals run in parallel via two `setInterval`s in the main `useEffect`

## Per-source timestamps

Context exposes `sourceTimestamps: { trains, ships, weather, events }` — each updated when its data is fetched. `refreshTrains` only touches `trains`; `refreshAll` updates all four.

## RefreshIndicator component (`src/components/RefreshIndicator.tsx`)

- Shows `● Xs sitten · ↻ M:SS` per data tab
- Pulses green dot when fresh (< intervalMs * 1.5), gray when stale
- RefreshCw icon spins in last 5 seconds before next refresh
- Self-contained 1s ticker — does NOT cause parent re-renders

## Where used

`DetailTabs.tsx` — one indicator at the top of each tab (Junat / Laivat / Tapahtumat / Sää) with the source label (Fintraffic / Averio / Linkedevents / Open-Meteo).
