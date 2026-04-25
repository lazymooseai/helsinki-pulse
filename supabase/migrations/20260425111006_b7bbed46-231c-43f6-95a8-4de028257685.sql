CREATE TABLE public.dispatch_scans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tolppa TEXT NOT NULL,
  k_now INTEGER,
  t_now INTEGER,
  k_30 INTEGER,
  t_30 INTEGER,
  raw_image_url TEXT,
  ocr_confidence NUMERIC,
  ocr_raw_text TEXT,
  notes TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  scanned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  scanned_by_device TEXT,
  source TEXT NOT NULL DEFAULT 'camera',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view dispatch_scans" ON public.dispatch_scans FOR SELECT USING (true);
CREATE POLICY "Anyone can insert dispatch_scans" ON public.dispatch_scans FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update dispatch_scans" ON public.dispatch_scans FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete dispatch_scans" ON public.dispatch_scans FOR DELETE USING (true);

CREATE TRIGGER update_dispatch_scans_updated_at
  BEFORE UPDATE ON public.dispatch_scans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_dispatch_scans_scanned_at ON public.dispatch_scans (scanned_at DESC);
CREATE INDEX idx_dispatch_scans_tolppa_time ON public.dispatch_scans (tolppa, scanned_at DESC);

ALTER TABLE public.dispatch_scans REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_scans;

INSERT INTO storage.buckets (id, name, public)
VALUES ('dispatch-scans', 'dispatch-scans', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view dispatch scan images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'dispatch-scans');

CREATE POLICY "Anyone can upload dispatch scan images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'dispatch-scans');

CREATE POLICY "Anyone can delete dispatch scan images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'dispatch-scans');