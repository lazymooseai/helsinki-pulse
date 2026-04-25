---
name: dispatch-scanner
description: Valityslaitteen naytön kameraskannaus + AI-OCR (Gemini 2.5 Flash) → live K/T-luvut tolppakohtaisesti
type: feature
---

## Tarkoitus
Kuljettaja kuvaa Taksi Helsinki -valityslaitteen naytön puhelimellaan TAI lataa screenshotin. Gemini 2.5 Flash lukee K+/T+/K-30/T-30 luvut + tolpan nimen. Data tallennetaan `dispatch_scans`-tauluun ja nakyy reaaliajassa dashboardilla.

## Tietokanta: dispatch_scans
- tolppa (TEXT, pakollinen), k_now, t_now, k_30, t_30 (INT, nullable)
- raw_image_url (Storage), ocr_confidence (0-1), ocr_raw_text, notes
- is_verified (kuljettaja vahvistanut), source ("camera" | "manual"), scanned_at
- RLS: julkinen CRUD (sama kuvio kuin events/taxi_trips)
- Realtime: REPLICA IDENTITY FULL + supabase_realtime publication
- Indexit: scanned_at DESC, (tolppa, scanned_at DESC)

## Storage: dispatch-scans bucket
- Julkinen luku/kirjoitus, tiedostopolut: `YYYY-MM-DD/{uuid}.jpg`

## Edge function: scan-dispatch
- POST { image: "data:image/jpeg;base64,..." } → { tolppa, k_now, t_now, k_30, t_30, confidence, raw_text }
- Kayttaa Lovable AI Gateway: `google/gemini-2.5-flash` + tool calling (`report_dispatch_numbers`)
- Hoitaa 429/402 -virheet asianmukaisesti

## Komponentit
- `src/lib/dispatchScans.ts` — runOcr, uploadScanImage, insertScan, listRecentScans, getLatestPerTolppa
- `src/components/DispatchScanner.tsx` — Sheet-pohjainen UI: kuva (kamera/tiedosto) + video (kamera/tiedosto, max 30s/50MB) + esikatselu + AI-luenta + manuaalinen korjaus + tallennus
- `src/components/DispatchLiveCard.tsx` — dashboard-kortti, viimeisimmat skannaukset per tolppa (max 120 min), realtime-kanava, signaali (KYSYNTA/TASAPAINO/YLITARJONTA = K-T diff)
- `src/components/ScanButton.tsx` — kelluva alanappi avaa DispatchScannerin

## Videoluenta
- `extractVideoFrames(file, {frameCount:4, maxDurationSec:30})` purkaa videosta tasaisin valein 4 JPEG-kehysta `<video>+<canvas>`-tekniikalla (ei lisariippuvuuksia, toimii selaimessa)
- Jokainen kehys ajetaan `runOcr`:n lapi (Promise.all), korkeimman `confidence`-arvon framesta otetaan luvut + tallennetaan still-kuvana storageen → schema sailyy samana
- Rajat: video max 30s + 50MB, kuva max 10MB

## Tuleva integraatio
- `getLatestPerTolppa()` palauttaa Mapin → CommandCenter voi lukea livea ja painottaa zone-suosituksia
- Aikasarja-analyysi: tunti × tolppa → ennusta ruuhkahuiput (samalla kuviolla kuin trip_patterns)
