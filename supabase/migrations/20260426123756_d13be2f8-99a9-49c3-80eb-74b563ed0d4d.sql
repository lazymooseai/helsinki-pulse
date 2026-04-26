-- Pre-bookings table for advance taxi orders
CREATE TABLE public.pre_bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tolppa TEXT NOT NULL,
  pickup_at TIMESTAMP WITH TIME ZONE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  raw_text TEXT,
  ocr_confidence NUMERIC,
  scanned_by_device TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Useful indexes
CREATE INDEX idx_pre_bookings_pickup_at ON public.pre_bookings(pickup_at);
CREATE INDEX idx_pre_bookings_tolppa ON public.pre_bookings(tolppa);

-- Enable RLS
ALTER TABLE public.pre_bookings ENABLE ROW LEVEL SECURITY;

-- Public access (matches dispatch_scans pattern)
CREATE POLICY "Anyone can view pre_bookings"
ON public.pre_bookings FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert pre_bookings"
ON public.pre_bookings FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update pre_bookings"
ON public.pre_bookings FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete pre_bookings"
ON public.pre_bookings FOR DELETE
USING (true);

-- updated_at trigger
CREATE TRIGGER update_pre_bookings_updated_at
BEFORE UPDATE ON public.pre_bookings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER TABLE public.pre_bookings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pre_bookings;