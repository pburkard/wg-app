-- Schedule recurring expense processing daily at 06:00 UTC (before cleaning rotation at 08:00)
select cron.schedule(
  'process-recurring-expenses',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://ovswtscpmnmkkxbueffg.supabase.co/functions/v1/process-recurring-expenses',
    headers := '{"Authorization": "Bearer ' || current_setting('supabase.service_role_key') || '"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
