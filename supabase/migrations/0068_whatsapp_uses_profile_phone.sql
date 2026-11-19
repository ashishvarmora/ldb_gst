-- 0068: One number for every contact.
--
-- Owner (19 Nov 2026): the profile's mobile is the single source of truth -
-- WhatsApp alerts go to profiles.phone, not to a second number typed in
-- Settings. whatsapp_configs keeps only the opt-in and its status.
--
-- Non-destructive: the old whatsapp_configs.phone column is left in place but
-- made optional, and the app no longer reads or writes it. It can be dropped
-- later in a cleanup migration once nothing older is deployed.

alter table public.whatsapp_configs alter column phone drop not null;

comment on column public.whatsapp_configs.phone is
  'Unused since 0068: WhatsApp alerts go to profiles.phone.';
comment on table public.whatsapp_configs is
  'WhatsApp alert opt-in per customer (0067). The number is always profiles.phone (0068).';
