---
name: prebookings
description: Ennakkotilausten kirjaus (kuva/PDF/teksti) + tuntikohtainen heatmap + halytys lahituntien ennakoista suosituksessa
type: feature
---

## Tarkoitus
Kuljettaja syottaa tulevia ennakkotilauksia (tolppa + noutoaika) AI-luennalla tai tekstilla. Data nakyy listana ja tunti×viikonpaiva-heatmappina. Suositus-tab nayttaa halytyksen jos ennakoita on lahistolla 60 min sisaan.

## Tietokanta: pre_bookings
- tolppa, pickup_at, source, notes, raw_text, ocr_confidence
- RLS: julkinen CRUD (sama kuvio kuin dispatch_scans)
- Realtime: REPLICA IDENTITY FULL + supabase_realtime publication
- Indeksit: pickup_at, tolppa

## Edge function: scan-prebookings
- POST { image | pdf, reference_date? } → { bookings: [{tolppa, pickup_at, confidence}], raw_text }
- Lovable AI Gateway: `gemini-2.5-flash` + responseSchema (array)
- pickup_at palautetaan ISO 8601 + Helsinki TZ

## Komponentit
- `src/lib/prebookings.ts` — runImageBookings, runPdfBookings, parseTextToBookings, insertBookings (bulk), listUpcomingBookings, listBookingsHistory
- `src/components/PrebookingScanner.tsx` — Sheet: kuva/PDF/teksti + manuaalisyotto + rivien tarkistus & muokkaus ennen tallennusta
- `src/components/PrebookingsCard.tsx` — Kortti dashboardilla:
  - **Lista**: tulevat ennakot countdownilla (myohassa/menossa/tunnit), urgent-banneri jos ≤15 min
  - **Heatmap**: paiva×tunti -aggregaatti viim. 30 paivasta, vyohykefiltteri
  - "Lisaa" -nappi avaa PrebookingScannerin
- `src/components/DispatchLiveCard.tsx` — RecommendView nayttaa BookingAlert-bannerin: ennakot 60 min sisaan & ≤5 km autosta (jos GPS olemassa)

## Tekstijasennys
- Tukee: ISO datetime, "HH:MM Tolppa", "Tolppa - HH:MM", CSV "Tolppa,HH:MM", JSON array
- Pelkka kellonaika → tama paiva (jos > 6h sitten → huomenna)
- HTML stripataan (htmlToText, jaettu dispatchScansin kanssa)

## Suositus-integraatio
- DispatchLiveCard tilaa myos pre_bookings realtime → paivittyy automaattisesti
- 60 min ennakko-cutoff, 5 km saatti GPS:lla
- Banneri amber-varissa suosituksen ylapuolella