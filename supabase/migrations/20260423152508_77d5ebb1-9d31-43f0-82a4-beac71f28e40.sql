create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'scrape-events-every-2h') then
    perform cron.unschedule('scrape-events-every-2h');
  end if;
end $$;

select cron.schedule(
  'scrape-events-every-2h',
  '0 */2 * * *',
  $cron$
  select net.http_post(
    url:='https://amxjbmvhhcnhmskcnzbe.supabase.co/functions/v1/scrape-events',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFteGpibXZoaGNuaG1za2NuemJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MzU0NDMsImV4cCI6MjA5MjUxMTQ0M30.IWcRNU_GFAoL-9ze5T3zI8JPZdDR_D0ntoSAtcTT6Yo"}'::jsonb,
    body:='{}'::jsonb
  );
  $cron$
);