---
name: Flights & Sports Real-Time
description: HEL-Vantaa flight arrivals (Finavia) and sports events with team/attendance data
type: feature
---

## Lennot (Finavia)

- **Edge function**: `supabase/functions/fetch-flights/index.ts`
- **URL**: `https://apigw.finavia.fi/flights/public/v0/flights/arr/HEL`
- **Auth**: header `app_key: <FINAVIA_API_KEY>`
- **Format**: XML, parsed with regex into flat key/value objects
- **Key XML fields**: `sdt` (scheduled), `pest_d`/`est_d` (estimated arrival), `act_d` (actual), `prm` (status code LAN/EXP/SCH/CXX), `prt_f` (Finnish status text), `route_1`+`route_n_fi_1` (origin IATA + Finnish name), `fltnr`, `bltarea` (belt), `gate`, `termid`
- **Filtering**: skip if `prm`==CXX/LAN or `prt_f` contains "peruttu"/"laskeutunut"; only arrivals in next 2h
- **Cache**: 60s in-memory
- **Refresh**: 2 min (`FLIGHT_REFRESH_MS`)

## Urheilu

- **File**: `src/lib/sports.ts` — `fetchSportsEvents()` + `getFallbackSportsEvents()`
- **Source 1**: LinkedEvents API with `keyword=yso:p965,yso:p916,yso:p6915` (urheilu/jääkiekko/jalkapallo)
- **Source 2 fallback**: weekday heuristic — opponents shown as "(vahvistamaton)" to avoid misleading drivers
- **Refresh**: 15 min (`SPORTS_REFRESH_MS`)
- **Venue capacities**: Nordis 16000 (HIFK current home), Helsinki Halli 13506, Helsingin Jäähalli 8200 (legacy), Bolt Arena 10770, Olympiastadion 36200
- **HIFK home venue**: Nordis (Garden Helsinki) — NOT old Jäähalli. League labels show "(arvio)" suffix when from fallback.
- **Team parsing**: regex on `/[–\-vs|@]+/` separators

## Sää (Open-Meteo)

- **URL parameter**: `&wind_speed_unit=ms` REQUIRED — defaults to km/h otherwise (gives 3.6× too high readings)

## DashboardContext

Now has 4 parallel refresh cycles: `refreshAll` (5min), `refreshTrains` (2min), `refreshFlights` (2min), `refreshSports` (15min). State has `flights: FlightArrival[]` and `sportsEvents: SportsEvent[]`. SourceTimestamps has matching `flights` and `sportsEvents` keys.

## DetailTabs

6 tabs: Junat / Lennot / Laivat / Urheilu / Tapaht. / Sää (grid-cols-6, 9px labels for fit on mobile).
