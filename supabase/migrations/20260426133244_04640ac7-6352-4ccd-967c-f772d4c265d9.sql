DELETE FROM public.pre_bookings WHERE tolppa LIKE '%**%' OR tolppa ILIKE '%päivämäärä%';
DELETE FROM public.dispatch_scans WHERE tolppa LIKE '%**%' OR tolppa ILIKE '%päivämäärä%';