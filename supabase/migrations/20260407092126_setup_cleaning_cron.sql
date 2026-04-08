-- Enable pg_cron and pg_net extensions (needed for HTTP calls from cron)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Schedule cleaning rotation daily at 08:00 UTC
select cron.schedule(
  'rotate-cleaning',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://ovswtscpmnmkkxbueffg.supabase.co/functions/v1/rotate-cleaning',
    headers := '{"Authorization": "Bearer ' || current_setting('supabase.service_role_key') || '"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
