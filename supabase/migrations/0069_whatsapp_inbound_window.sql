-- 0069: WhatsApp's 24-hour customer service window.
--
-- When a customer messages the Rahdari number, WhatsApp lets us reply with
-- plain text (no approved template needed) for 24 hours. The webhook records
-- when each number last wrote to us; alerts inside that window go out as
-- plain text, outside it as an approved template.
--
-- Only the WhatsApp id (91XXXXXXXXXX) and the time are kept - never the
-- message content. Service role only, like every other app table (0063).

create table if not exists public.whatsapp_inbound (
  wa_id            text primary key check (wa_id ~ '^[0-9]{8,15}$'),
  last_inbound_at  timestamptz not null,
  message_count    integer not null default 1,
  updated_at       timestamptz not null default now()
);

comment on table public.whatsapp_inbound is
  'When each WhatsApp number last messaged Rahdari, for the 24-hour reply window (0069). No message content.';

alter table public.whatsapp_inbound enable row level security;
revoke all on public.whatsapp_inbound from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_inbound to service_role;
