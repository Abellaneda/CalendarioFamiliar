-- Tareas programadas de pg_cron:
-- 1. Resumen semanal dominical (corre a las 18:00 y 19:00 UTC para garantizar 20:00 Madrid en verano e invierno)
-- 2. Resumen diario a las 8:00 Madrid (corre a las 6:00 y 7:00 UTC)
-- 3. Recordatorios automáticos cada hora

SELECT cron.unschedule('alerta-semanal-domingo-20h');

SELECT cron.schedule(
  'resumen-semanal-invierno',
  '0 19 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://<tu-proyecto>.supabase.co/functions/v1/telegram-bot/resumen-cron',
    headers := '{"Content-Type": "application/json", "x-telegram-bot-api-secret-token": "<tu-webhook-secret>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'resumen-semanal-verano',
  '0 18 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://<tu-proyecto>.supabase.co/functions/v1/telegram-bot/resumen-cron',
    headers := '{"Content-Type": "application/json", "x-telegram-bot-api-secret-token": "<tu-webhook-secret>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'recordatorios-cada-hora',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<tu-proyecto>.supabase.co/functions/v1/telegram-bot/recordatorios-cron',
    headers := '{"Content-Type": "application/json", "x-telegram-bot-api-secret-token": "<tu-webhook-secret>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
