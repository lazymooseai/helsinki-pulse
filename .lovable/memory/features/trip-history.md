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
- `TripsHistory.tsx` — filtterit (haku, tunti-slider, viikonpäivät, hinta) + tilastot + CSV-export
- `TripHistoryCard.tsx` — dashboard-kortti: tänään, tämä tunti hist., paras lähtöalue. Päivittyy 5min välein.
- `TripsTabs.tsx` — yhdistää 3 osaa (Historia/Lisää/Tuonti) Index-sivulle

## Excel-parsinta
- SheetJS (`xlsx`) — pakolliset sarakkeet `trip_id`, `start_time`. Tukee CSV/XLSX/XLS.
- Sarakenimet kiinteät (case-insensitive). Excel-päivämääräserialit konvertoidaan ISO:ksi.

## trip_patterns -kysely
- `getCurrentHourPattern()` käyttää suoraa REST-fetchia (näkymää ei ole types.ts:ssä).
- ISO-viikonpäivä lasketaan: `((getDay() + 6) % 7) + 1` (ma=1 ... su=7)