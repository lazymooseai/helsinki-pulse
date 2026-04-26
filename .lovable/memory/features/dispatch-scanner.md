---
name: dispatch-scanner
description: Valityslaitteen naytön kameraskannaus + AI-OCR + sijaintitietoinen tolppa-dashboard (lähimmät, vyöhyke, suositus, heatmap)
type: feature
---

## Tarkoitus
Kuljettaja syöttää tolppadataa neljällä tavalla: (1) kuva valityslaitteen naytöstä, (2) video, (3) PDF-raportti, (4) TXT/CSV/JSON/HTML-tiedosto. Gemini 2.5 Flash lukee K+/T+/K-30/T-30 + tolpan nimen kuvista ja PDF:stä. HTML/TXT/CSV jäsennetään lokaalisti selaimessa (nopeaa). Data nakyy reaaliajassa sijaintitietoisessa dashboardissa.

## Tietokanta: dispatch_scans
- tolppa, k_now, t_now, k_30, t_30, raw_image_url, ocr_confidence, ocr_raw_text, notes
- is_verified, source ("camera" | "manual" | "text" | "pdf"), scanned_at
- RLS: julkinen CRUD. Realtime: REPLICA IDENTITY FULL + supabase_realtime publication

## Storage: dispatch-scans bucket (julkinen)

## Edge function: scan-dispatch
- POST { image | pdf } → { tolppa, k_now, t_now, k_30, t_30, confidence, raw_text }
- Lovable AI Gateway: `google/gemini-2.5-flash` + tool calling

## Komponentit
- `src/lib/dispatchScans.ts` — runOcr, runPdfOcr, parseTextToOcr (TXT/CSV/JSON), htmlToText, fileToJpegDataUrl, extractVideoFrames, listScansSince (heatmap-data)
- `src/lib/tolppaLocations.ts` — TOLPAT (50+ tunnetua tolppaa Hki/Espoo/Vantaa), findTolppa (alias-haku), distanceKm (Haversine), Zone-luokitus
- `src/hooks/useGeolocation.ts` — selain GPS + manuaalivalinta-fallback (localStorage)
- `src/components/DispatchScanner.tsx` — Sheet UI: kuva/video/dokumentti + esikatselu + AI-luenta + manuaali korjaus
- `src/components/DispatchLiveCard.tsx` — 4 tabia:
  - **Lähimmät**: top 5 lähintä tolppaa GPS:stä + etäisyys (km)
  - **Vyöhyke**: yhteenveto per alue (kesk/itä/länsi/poh, Espoo, Vantaa, lentoasema) + paras tolppa per vyöhyke
  - **Suositus**: yksi "mene tänne" pisteytyksellä `(K-T)*1.5 + future*0.5 - distanceKm`
  - **Heatmap**: tunti × tolppa -aggregaatti viim. 14 päivän skannauksista, vyöhykefiltteri
- `src/components/ScanButton.tsx` — kelluva alanappi avaa DispatchScannerin

## Sijaintilogiikka
- GPS oletus, manuaalivalinta fallback (7 vyöhykettä). Tallentuu localStorageen.
- GPS päivittyy 5 min välein automaattisesti.
- Tolpat matchataan nimellä + aliaksilla normalisoidulla haulla (lowercase, ilman ääkkösiä, sisältyvyys).

## Heatmap-väri
- diff >= 5: vahva vihreä (kuuma)
- diff 2..4: vihreä
- diff 0..1: amber
- diff -3..-1: vaalea punainen
- diff < -3: punainen (ylitarjonta)
