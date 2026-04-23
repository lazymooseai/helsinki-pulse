---
name: trip-history
description: Kyytihistoria-moduuli — taxi_trips taulu, trip_patterns view, tuonti/lomake/historia/analytiikka
type: feature
---

## Tietokanta
- `taxi_trips`: trip_id (UNIQUE), start_time, koordinaatit, hinta, matka, kesto, vehicle_id, payment_method, source_file
- Generated columns Helsinki-ajalla: hour_of_day, day_of_week (ISO 1=ma), is_weekend, week_number, month_num
- `trip_patterns` view: aggregaatit (hour × dow × start_area) → trip_count, avg_fare, avg_distance
- RLS: julkinen luku/kirjoitus (sama malli kuin events)

## Komponentit (src/components/trips/)
- `TripsImport.tsx` — drag&drop CSV/XLSX, esikatselu 10 riviä, duplikaattien ohitus trip_id:n perusteella
- `TripsManualForm.tsx` — zod-validoitu lomake; trip_id auto-generoidaan (`manual-{ts}-{rand}`)
- `TripsHistory.tsx` — filtterit (haku, tunti-slider, viikonpäivät, hinta) + tilastot + CSV-export. Lista on **piilotettu oletuksena** (toggle-nappi). Pagination 100 kerralla "Lataa lisää" -napilla. Lähtö/kohde näytetään aluenimeltään (ei lat,lon).
- `TripHistoryCard.tsx` — dashboard-kortti: tänään, tämä tunti hist., **top 3 lähtöaluetta nyt** + **ennustebadget seuraavalle 2 tunnille**. Päivittyy 5min välein.
- `TripsTabs.tsx` — yhdistää 3 osaa (Historia/Lisää/Tuonti) Index-sivulle

## Aluemuunnos (src/lib/areas.ts)
- `NAMED_AREAS` — n. 70 nimettyä Helsingin/PKS:n aluetta (Kamppi, Kallio, Pasilan asema, Lentoasema, Tapiola, Itäkeskus...)
- `nearestArea(lat, lon, maxKm=1.5)` — haversine-pohjainen lähimmän alueen haku, säde-painotettu
- `coarseFallback` — "Muu Helsinki" / "Espoo" / "Vantaa" / "Itä-Uusimaa" jos > 1.5 km lähimmästä
- `resolveAreaName(addr, lat, lon)` — käytä aina kun näytetään lähtö/kohde käyttäjälle. Tukee myös "lat,lon"-merkkijonoja `start_address`-kentässä (data on raakaa GPS-paria).

## Excel-parsinta
- SheetJS (`xlsx`) — pakolliset sarakkeet `trip_id`, `start_time`. Tukee CSV/XLSX/XLS.
- Sarakenimet kiinteät (case-insensitive). Excel-päivämääräserialit konvertoidaan ISO:ksi.

## Aluepatternit (src/lib/trips.ts)
- `getTopAreasForWindow({ hours, daysOfWeek?, topN })` — hakee `taxi_trips`-rivit annetuille tunneille (saman viikonpäivän rajauksella oletuksena), aggregoi client-puolella `resolveAreaName`-funktiolla, palauttaa top-N alueet (trips, avgFare).
- `getCurrentHourPattern()` on yhteensopivuus-wrapper, käyttää `getTopAreasForWindow` topN=1.
- `trip_patterns` SQL-näkymä on **deprecated** — lähtöosoitteet ovat raakaa lat,lon-merkkijonoja jotka eivät ryhmity SQL:ssä järkevästi. Aluemuunnos tehdään aina client-puolella.
- `queryTrips` palauttaa `{ rows, total }` ja tukee `offset`-parametria paginationiin.
- ISO-viikonpäivä lasketaan: `((getDay() + 6) % 7) + 1` (ma=1 ... su=7)