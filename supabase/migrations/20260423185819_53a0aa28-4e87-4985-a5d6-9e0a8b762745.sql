
-- Siivoa geneeriset "ei tietoa" -notes-rivit
update public.events
set availability_note = null
where availability_note ~* '(tiedot? puuttu|lisatieto|ei saatavilla|tarkista my[oö]hemm|^etsi|^haet|ei tietoa|ei m?yynniss)';

-- Varmista pg_cron + pg_net (Lovable Cloudissa yleensa jo paalla, mutta turvallinen idempotentisti)
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Poista vanha jos on
do $$
begin
  if exists (select 1 from cron.job where jobname = 'enrich-event-tickets-4h') then
    perform cron.unschedule('enrich-event-tickets-4h');
  end if;
end $$;

-- Aja 4h valein
select
  cron.schedule(
    'enrich-event-tickets-4h',
    '0 */4 * * *',
    $$
    select
      net.http_post(
        url := 'https://amxjbmvhhcnhmskcnzbe.supabase.co/functions/v1/enrich-event-tickets',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFteGpibXZoaGNuaG1za2NuemJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MzU0NDMsImV4cCI6MjA5MjUxMTQ0M30.IWcRNU_GFAoL-9ze5T3zI8JPZdDR_D0ntoSAtcTT6Yo"}'::jsonb,
        body := '{}'::jsonb
      ) as request_id;
    $$
  );
