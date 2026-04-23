
UPDATE public.events
SET 
  load_factor = 0.5,
  tickets_sold = ROUND(capacity * 0.5),
  availability_note = COALESCE(availability_note, 'Oletusarvio – tarkka tieto päivittyy seuraavassa skrapauksessa')
WHERE source = 'scraper'
  AND load_factor IS NULL
  AND capacity IS NOT NULL
  AND sold_out = false;
