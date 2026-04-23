-- Taxi trips: kyytihistoria
CREATE TABLE public.taxi_trips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id TEXT NOT NULL UNIQUE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  start_address TEXT,
  start_lat DOUBLE PRECISION,
  start_lon DOUBLE PRECISION,
  end_address TEXT,
  end_lat DOUBLE PRECISION,
  end_lon DOUBLE PRECISION,
  fare_eur NUMERIC(10,2),
  distance_km NUMERIC(10,2),
  duration_min INTEGER,
  vehicle_id TEXT,
  payment_method TEXT,
  source_file TEXT,
  -- Generated columns Helsinki-aikavyöhykkeellä
  hour_of_day INTEGER GENERATED ALWAYS AS (EXTRACT(HOUR FROM (start_time AT TIME ZONE 'Europe/Helsinki'))::int) STORED,
  day_of_week INTEGER GENERATED ALWAYS AS (EXTRACT(ISODOW FROM (start_time AT TIME ZONE 'Europe/Helsinki'))::int) STORED,
  is_weekend BOOLEAN GENERATED ALWAYS AS (EXTRACT(ISODOW FROM (start_time AT TIME ZONE 'Europe/Helsinki'))::int >= 6) STORED,
  week_number INTEGER GENERATED ALWAYS AS (EXTRACT(WEEK FROM (start_time AT TIME ZONE 'Europe/Helsinki'))::int) STORED,
  month_num INTEGER GENERATED ALWAYS AS (EXTRACT(MONTH FROM (start_time AT TIME ZONE 'Europe/Helsinki'))::int) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_taxi_trips_start_time ON public.taxi_trips (start_time DESC);
CREATE INDEX idx_taxi_trips_hour ON public.taxi_trips (hour_of_day);
CREATE INDEX idx_taxi_trips_dow ON public.taxi_trips (day_of_week);
CREATE INDEX idx_taxi_trips_start_address ON public.taxi_trips (start_address);

ALTER TABLE public.taxi_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view taxi_trips"
  ON public.taxi_trips FOR SELECT USING (true);

CREATE POLICY "Anyone can insert taxi_trips"
  ON public.taxi_trips FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update taxi_trips"
  ON public.taxi_trips FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete taxi_trips"
  ON public.taxi_trips FOR DELETE USING (true);

CREATE TRIGGER update_taxi_trips_updated_at
  BEFORE UPDATE ON public.taxi_trips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trip patterns: aggregaatit (tunti × viikonpäivä × lähtöalue)
CREATE VIEW public.trip_patterns AS
SELECT
  hour_of_day,
  day_of_week,
  is_weekend,
  COALESCE(start_address, 'Tuntematon') AS start_area,
  COUNT(*)::int AS trip_count,
  ROUND(AVG(fare_eur)::numeric, 2) AS avg_fare,
  ROUND(AVG(distance_km)::numeric, 2) AS avg_distance,
  ROUND(AVG(duration_min)::numeric, 1) AS avg_duration
FROM public.taxi_trips
WHERE start_time IS NOT NULL
GROUP BY hour_of_day, day_of_week, is_weekend, start_area;