UPDATE events
SET load_factor = NULL,
    tickets_sold = NULL,
    availability_note = NULL,
    demand_level = 'green',
    demand_tag = 'NORMAALI'
WHERE source = 'scraper'
  AND sold_out = false
  AND (
    availability_note LIKE 'Arvio:%'
    OR availability_note LIKE 'AI-arvio%'
    OR availability_note IS NULL
  );