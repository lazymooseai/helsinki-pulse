---
name: Events Tracking
description: Reaaliaikainen tapahtumahaku Firecrawl-skrapauksella + manuaaliset overridet, 7pv ikkuna
type: feature
---
**Lähde:** `events`-taulu Lovable Cloudissa (RLS public).

**Skrapaus:** `scrape-events` edge function ajaa Firecrawlin ~10 venuelle (oopperabaletti.fi, helsinginjaahalli.fi, stadion.fi, musiikkitalo.fi, hkt.fi, kansallisteatteri.fi, tanssintalo.fi, savoyteatteri.fi, messukeskus.com, veikkausarena.fi). Lovable AI (gemini-2.5-flash) jäsentelee markdownin → strukturoitu JSON (name, start_time, end_time, sold_out, load_factor).

**Cron:** `scrape-events-every-2h` ajaa 2h välein (pg_cron + pg_net). Upsert via `external_id`.

**UI (CapacityFeeds.tsx):**
- "Tapahtumat Tänään (N)" + "Lisää" -nappi
- Aktiiviseksi laskettu = T-4h ennen alkua → end_time
- "Tulevat (N) — 7 pv" laajennettava sektio (UpcomingEventCard)
- AddEventModal: nimi, paikka (KNOWN_VENUES), pvm, alkaa, päättyy, myydyt liput
- Manuaaliset (is_manual=true) voi poistaa (Trash2-painike)

**Realtime:** events-taulu kuuntelussa DashboardContextissa, refetch automaattisesti.

**API (events.ts):** `fetchEventsBundle()`, `addManualEvent()`, `deleteManualEvent()`, `triggerEventScrape()`.
