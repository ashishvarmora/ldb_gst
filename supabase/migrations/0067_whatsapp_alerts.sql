-- 0067: WhatsApp alerts (Meta WhatsApp Cloud API, sender "Rahdari" +91 92134 34855).
--
-- whatsapp_configs   one row per customer: the number alerts go to and their
--                    opt-in. WhatsApp's business policy requires an explicit
--                    opt-in before a business messages someone, so the row is
--                    only written when the customer ticks the box in Settings.
-- whatsapp_messages  every send, keyed by Meta's message id (wamid), so the
--                    webhook can record sent / delivered / read / failed. The
--                    full number is not kept here, only its last four digits,
--                    and no message text (alerts are already in alert_logs).
--
-- Service role only, like every other table the app writes (0063).

create table if not exists public.whatsapp_configs (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  -- E.164 without the plus, India only for now: 91 + ten digits.
  phone        text not null check (phone ~ '^91[6-9][0-9]{9}$'),
  is_enabled   boolean not null default true,
  opted_in_at  timestamptz not null default now(),
  verified_at  timestamptz,
  last_error   text,
  updated_at   timestamptz not null default now()
);

comment on table public.whatsapp_configs is
  'Where a customer''s alerts go on WhatsApp, and when they opted in (0067).';

create table if not exists public.whatsapp_messages (
  id             bigint generated always as identity primary key,
  wamid          text unique,
  user_id        uuid references public.profiles (id) on delete set null,
  to_last4       text,
  template       text,
  purpose        text not null check (purpose in ('alert', 'test', 'otp')),
  status         text not null default 'accepted'
                   check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  error_code     integer,
  error_message  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.whatsapp_messages is
  'One row per WhatsApp send and its delivery status from the webhook (0067). No message text, no full number.';

create index if not exists whatsapp_messages_user_idx on public.whatsapp_messages (user_id, created_at desc);

alter table public.whatsapp_configs enable row level security;
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_configs from public, anon, authenticated;
revoke all on public.whatsapp_messages from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_configs to service_role;
grant select, insert, update, delete on public.whatsapp_messages to service_role;
