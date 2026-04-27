
-- Laivojen matkustajamäärien historia oppimista varten
CREATE TABLE public.ship_pax_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ship TEXT NOT NULL,
  terminal TEXT NOT NULL,
  arrival_time TIMESTAMP WITH TIME ZONE NOT NULL,
  pax INTEGER NOT NULL DEFAULT 0,
  day_of_week INTEGER,         -- 1..7 (ISO)
  hour_of_day INTEGER,         -- 0..23
  month_num INTEGER,           -- 1..12
  is_weekend BOOLEAN,
  weather_code INTEGER,        -- Open-Meteo weather code
  temperature_c NUMERIC,
  source TEXT NOT NULL DEFAULT 'averio',  -- averio | port_of_helsinki | manual
  observed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (ship, arrival_time, source)
);

CREATE INDEX idx_ship_pax_history_ship ON public.ship_pax_history (ship);
CREATE INDEX idx_ship_pax_history_terminal ON public.ship_pax_history (terminal);
CREATE INDEX idx_ship_pax_history_arrival ON public.ship_pax_history (arrival_time DESC);
CREATE INDEX idx_ship_pax_history_dow_hour ON public.ship_pax_history (day_of_week, hour_of_day);

ALTER TABLE public.ship_pax_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view ship_pax_history"
  ON public.ship_pax_history FOR SELECT USING (true);
CREATE POLICY "Anyone can insert ship_pax_history"
  ON public.ship_pax_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update ship_pax_history"
  ON public.ship_pax_history FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete ship_pax_history"
  ON public.ship_pax_history FOR DELETE USING (true);

CREATE TRIGGER update_ship_pax_history_updated_at
  BEFORE UPDATE ON public.ship_pax_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Agentin ennusteet ja niiden vertailu todellisiin määriin
CREATE TABLE public.ship_pax_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ship TEXT NOT NULL,
  terminal TEXT NOT NULL,
  arrival_time TIMESTAMP WITH TIME ZONE NOT NULL,
  predicted_pax INTEGER NOT NULL,
  actual_pax INTEGER,
  error_abs INTEGER,           -- |predicted - actual|
  error_pct NUMERIC,           -- error / actual * 100
  model TEXT NOT NULL DEFAULT 'gemini-flash',
  reasoning TEXT,
  features JSONB,              -- mistä piirteistä ennuste tehtiin (dow, hour, sää, hist. ka. jne.)
  predicted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  evaluated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (ship, arrival_time, model)
);

CREATE INDEX idx_ship_pax_pred_ship ON public.ship_pax_predictions (ship);
CREATE INDEX idx_ship_pax_pred_arrival ON public.ship_pax_predictions (arrival_time DESC);

ALTER TABLE public.ship_pax_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view ship_pax_predictions"
  ON public.ship_pax_predictions FOR SELECT USING (true);
CREATE POLICY "Anyone can insert ship_pax_predictions"
  ON public.ship_pax_predictions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update ship_pax_predictions"
  ON public.ship_pax_predictions FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete ship_pax_predictions"
  ON public.ship_pax_predictions FOR DELETE USING (true);

CREATE TRIGGER update_ship_pax_predictions_updated_at
  BEFORE UPDATE ON public.ship_pax_predictions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
