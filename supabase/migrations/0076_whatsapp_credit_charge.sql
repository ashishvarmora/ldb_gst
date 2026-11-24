-- ===========================================================================
-- 0076: WhatsApp alerts cost credits (owner, 24 Nov 2026). NOT YET APPLIED.
--
-- Each WhatsApp message sent to a customer - truck alerts and the notices that
-- go on WhatsApp - draws a small amount from their credit balance. The admin
-- daily summary and the customer's own "Send test" stay free.
--
--   credit_rates 'whatsapp_alert'   units_per_credit = 5, i.e. 0.2 credit a
--                                   message. Edited like every other rate on
--                                   Admin -> Plans -> Rules (RateEditor).
--   app_settings whatsapp_charge_enabled = true. The ON/OFF switch, on
--                                   Admin -> Settings -> Tracking.
--
-- Nothing else changes in the database:
--   - spend_credits() (0073) charges any action that has a credit_rates row;
--     only 'auto_check' needs an active plan, so a WhatsApp charge works for
--     any active account with the balance (held credits excluded).
--   - credit_transactions.reason is free text; credit_ledger_daily groups by
--     reason and credit_source() files every negative delta as 'spend', so
--     the new reason is counted as usage everywhere without a view change.
--
-- How the app uses it (src/lib/whatsapp-charge.ts): the balance is checked
-- before the message is sent and the charge is written only AFTER Meta has
-- accepted it, so an unsent message is never charged and each sent message is
-- charged at most once. Until this migration is applied there is no rate row,
-- and the app sends WhatsApp free exactly as before.
-- ===========================================================================

insert into public.credit_rates (action, label, description, units_per_credit) values
  ('whatsapp_alert', 'WhatsApp alert',
   'One WhatsApp message about your truck or account: reached a plaza, moved, halted, moving again, tracking paused. The test message is free.',
   5)
on conflict (action) do nothing;

insert into public.app_settings (key, value)
values ('whatsapp_charge_enabled', 'true'::jsonb)
on conflict (key) do nothing;
