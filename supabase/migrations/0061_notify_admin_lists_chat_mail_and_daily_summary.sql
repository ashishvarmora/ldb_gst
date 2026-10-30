-- 0061: a "Notify admin" section with several addresses, an email when a chat
-- message goes unread, and a daily summary.
--
-- 1. admin_notify_emails replaces admin_notify_email. A list, because the
--    owner wants the takings announced to more than one inbox. The old single
--    value is carried into the list so nobody stops hearing anything; the old
--    key is left in place (unread from now on) rather than deleted, so a
--    rollback of the code still finds it.
--
-- 2. New mail switches, with the defaults the owner was recommended:
--      admin_notify_payment_failed   ON   money that did not arrive is a lead
--      admin_notify_payment_rescued  ON   a payment the reconcile sweep had to
--                                         settle - the webhook missed it
--      admin_notify_chat             ON   a customer message left unread
--      admin_notify_checkout_started OFF  every opened checkout is noisy
--      admin_notify_daily_summary    ON   one mail a day, at daily_summary_hour IST
--      chat_email_enabled            ON   email the CUSTOMER about an unread
--                                         admin reply
--      chat_email_delay_minutes      2
--      daily_summary_hour            21   (9 pm IST, the day is mostly over)
--
-- 3. chat_messages.emailed_at - set when an unread message has been mailed
--    about, so each message is mailed about at most once.

insert into public.app_settings (key, value)
select 'admin_notify_emails',
       case
         when coalesce(btrim(value #>> '{}'), '') = '' then '[]'::jsonb
         else jsonb_build_array(lower(btrim(value #>> '{}')))
       end
from public.app_settings
where key = 'admin_notify_email'
on conflict (key) do nothing;

insert into public.app_settings (key, value) values
  ('admin_notify_emails', '[]'::jsonb),
  ('admin_notify_payment_failed', 'true'::jsonb),
  ('admin_notify_payment_rescued', 'true'::jsonb),
  ('admin_notify_chat', 'true'::jsonb),
  ('admin_notify_checkout_started', 'false'::jsonb),
  ('admin_notify_daily_summary', 'true'::jsonb),
  ('chat_email_enabled', 'true'::jsonb),
  ('chat_email_delay_minutes', '2'::jsonb),
  ('daily_summary_hour', '21'::jsonb)
on conflict (key) do nothing;

alter table public.chat_messages
  add column if not exists emailed_at timestamptz;

comment on column public.chat_messages.emailed_at is
  'When the other side was emailed because this message sat unread. Null = not mailed. Set once, so a message is never mailed about twice (0061).';

-- The sweep's read: unread, not yet mailed. Partial, so it stays the size of
-- the backlog rather than the week.
create index if not exists chat_messages_unmailed_idx
  on public.chat_messages (sender_role, created_at)
  where read_at is null and emailed_at is null;
