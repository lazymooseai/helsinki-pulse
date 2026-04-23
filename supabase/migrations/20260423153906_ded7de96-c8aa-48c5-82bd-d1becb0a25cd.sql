-- Taydennä kapasiteetit olemassa oleviin tapahtumiin (jos venue tunnetaan mutta cap puuttuu)
UPDATE events SET capacity = 1200, updated_at = now() WHERE capacity IS NULL AND venue ILIKE '%Ääniwalli%';
UPDATE events SET capacity = 250, updated_at = now() WHERE capacity IS NULL AND venue ILIKE 'Semifinal';
UPDATE events SET capacity = 400, updated_at = now() WHERE capacity IS NULL AND venue ILIKE 'Siltanen';
UPDATE events SET capacity = 300, updated_at = now() WHERE capacity IS NULL AND venue ILIKE 'Bar Loose';
UPDATE events SET capacity = 500, updated_at = now() WHERE capacity IS NULL AND (venue ILIKE '%Korjaamo%' OR venue = 'Kulttuuritehdas Korjaamo');
UPDATE events SET capacity = 2500, updated_at = now() WHERE capacity IS NULL AND venue ILIKE '%Kisahalli%';
UPDATE events SET capacity = 15500, updated_at = now() WHERE capacity IS NULL AND venue ILIKE '%Veikkaus Arena%';
UPDATE events SET capacity = 400, updated_at = now() WHERE capacity IS NULL AND venue ILIKE '%Konepajan näyttämö%';
UPDATE events SET capacity = 120, updated_at = now() WHERE capacity IS NULL AND venue ILIKE '%Teatteri Jurkka%';
UPDATE events SET capacity = 300, updated_at = now() WHERE capacity IS NULL AND venue ILIKE '%Opistotalo%';