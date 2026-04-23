
-- Tapahtumataulu: skrapatut tapahtumat venue-sivuilta + manuaaliset overridet
CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT UNIQUE, -- venue-sivun tunniste (deduplikointi)
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  capacity INTEGER,
  tickets_sold INTEGER,
  load_factor NUMERIC, -- 0.0 - 1.0, lasketaan jos tickets_sold + capacity
  sold_out BOOLEAN NOT NULL DEFAULT false,
  demand_level TEXT NOT NULL DEFAULT 'amber', -- 'red' | 'amber' | 'green'
  demand_tag TEXT,
  source_url TEXT,
  source TEXT NOT NULL DEFAULT 'scraper', -- 'scraper' | 'manual' | 'linkedevents'
  is_manual BOOLEAN NOT NULL DEFAULT false,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_start_time ON public.events(start_time);
CREATE INDEX idx_events_venue ON public.events(venue);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Driver-app on julkinen (ei autentikointia) -> kaikki saa lukea
CREATE POLICY "Anyone can view events"
  ON public.events FOR SELECT
  USING (true);

-- Manuaaliset insertit/updates sallittu kaikille (driver UI)
CREATE POLICY "Anyone can insert events"
  ON public.events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update events"
  ON public.events FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete manual events"
  ON public.events FOR DELETE
  USING (is_manual = true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER TABLE public.events REPLICA IDENTITY FULL;

-- pg_cron + pg_net for scheduled scraping
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
