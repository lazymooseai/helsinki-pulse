---
name: Events Tracking
description: Reaaliaikainen tapahtumahaku Firecrawlilla + 4h aikajananakyma 4 tabilla (Asemat/Kulttuuri/Urheilu/Muut), max 5/tab
type: feature
---
**Lähde:** `events`-taulu Lovable Cloudissa (RLS public).

**Skrapaus:** `scrape-events` edge function ajaa Firecrawlin ~10 venuelle (oopperabaletti.fi, helsinginjaahalli.fi, stadion.fi, musiikkitalo.fi, hkt.fi, kansallisteatteri.fi, tanssintalo.fi, savoyteatteri.fi, messukeskus.com, veikkausarena.fi). Lovable AI (gemini-2.5-flash) jäsentelee markdownin → strukturoitu JSON (name, start_time, end_time, sold_out, load_factor).

**Cron:** `scrape-events-every-2h` ajaa 2h välein (pg_cron + pg_net). Upsert via `external_id`.

**UI (EventsTimeline.tsx + CapacityFeeds.tsx):**
- 4h aikajana yhdistaa lentoja, junia, laivoja, tapahtumia, urheilua
- 4 valilehtea swaipattavina (react-swipeable + napit + nuolet):
  Asemat / Kulttuuri / Urheilu / Muut
- Oletusikkuna: Nyt + 2h, +2h-nappi laajentaa 4h asti
- Kova raja: max 5 itemia/tab, "Nayta kaikki N" -nappi laajentaa
- Lajittelu: weight (red+capacity bonus) > startMs
- Kategorisointi: ENSIN tapahtuman NIMI (KULTTUURI_NAME_KEYS / URHEILU_NAME_KEYS),
  vasta sitten venue. Korjaa ristiriidan jossa konsertti urheiluareenalla
  meni urheiluksi. Avain: lib/eventCategories.ts -> categorizeEvent(name, venue).
- Klikkaus avaa yhteisen TimelineDetailSheet (kaikki lahteet samalla kuvuolla)
- Lipunmyyntiprosentti nakyy kortilla (Ticket-icon + %), detailissa rivi
  "Lipunmyynti" ja "Tilanne" (availability_note).
- AddEventModal + DispatchEditModal sailyvat ennallaan

**Lipunmyyntitiedot:**
- Tarkat: TICKET_SOURCES (lippu.fi, tiketti.fi, venue-omat) skrapataan ja
  matchataan nimella aggregaattorin tapahtumiin.
- AI-arvio: jaljelle jaaville tehdaan yksi batch-call gemini-2.5-flashille,
  joka palauttaa load_factor (0..1) + reasoning (heuristiikka venue-koko +
  artisti + viikonpaiva).
- DB: events.availability_note tallentaa joko "Vain N paikkaa jaljella" tai
  "Arvio: ...". UI naytttaa sen "Tilanne"-rivilla.

**Realtime:** events-taulu kuuntelussa DashboardContextissa, refetch automaattisesti.

**API (events.ts):** `fetchEventsBundle()`, `addManualEvent()`, `deleteManualEvent()`, `triggerEventScrape()`.
