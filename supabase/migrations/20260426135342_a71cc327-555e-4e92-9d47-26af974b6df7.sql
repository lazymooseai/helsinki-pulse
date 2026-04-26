DELETE FROM public.dispatch_scans
WHERE tolppa IS NULL
   OR length(trim(tolppa)) < 3
   OR tolppa ~ '[*_`#]'
   OR tolppa ILIKE '%päivämäärä%'
   OR tolppa ILIKE '%paivamaara%'
   OR lower(trim(tolppa)) IN ('ryhmä','ryhma','tolppa','asema','tuntematon','unknown','n/a','na');