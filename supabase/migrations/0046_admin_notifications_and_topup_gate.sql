-- ===========================================================================
-- Telling an administrator when money or a customer arrives - and the settings
-- row that switches it on.
--
-- The owner: "get mail notification to (( X = admin can setup that mail via
-- admin pannel ) and that admin mail can be notified when: new customer signup
-- / buy a plan / topup credit".
--
-- Four rows and no schema. The events themselves already exist in the app -
-- sign-up creates the account, settle_payment() hands over what was bought -
-- so all this file adds is the address to write to and three switches.
--
-- WHY THE ADDRESS IS NOT support_email. support_email is published: it is in
-- the footer of every public page and it is what a customer is told to write
-- to. This one is never shown to anybody, and it is where the takings are
-- announced. Somebody who wants a shared help@ address in the footer and their
-- own phone buzzing at midnight cannot have both out of one row, and an
-- operator who reads them as the same thing has published the wrong one.
--
-- WHY THREE SWITCHES AND NOT JUST THE ADDRESS. Blank is already the kill
-- switch, but it is all-or-nothing, and the three events do not arrive at the
-- same rate. Registrations are free to make and can be scripted; payments are
-- rare and always worth reading. An owner drowning in sign-up mail would have
-- to clear the address to stop it, and would lose the payment mail with it -
-- which is the one they actually asked for. So each event gets its own row and
-- they all start on, so setting the address is the only step.
--
-- Named admin_notify_* so the four sort together in app_settings and the suffix
-- says which event it governs - 0043's reasoning about key naming, followed.
--
-- ---------------------------------------------------------------------------
-- A TOP-UP NOW NEEDS A PLAN, AND DELIBERATELY NOT IN HERE.
--
-- The owner has reversed the rule this schema still carries a comment about:
-- "there is Plan must be needed for topup (if already have a plan then perfect
-- !!) credit is never expired". officer_overview.plan_active is annotated "An
-- account may buy credits only while a plan is live", which was written for the
-- old rule, went stale when credits were opened to everyone, and is roughly
-- true again now. It is left as it is rather than rewritten, because the gate
-- is not in the database and a comment here would be the only thing implying
-- it is.
--
-- The gate belongs where the SALE is started - startCheckout() in
-- src/app/portal/plan/checkout-actions.ts - and it must NOT be in
-- settle_payment(). By the time settlement runs the money has been taken, and a
-- database that refused to hand over credits somebody had already paid for
-- would be keeping their money. Refusing to open the order is the only place
-- this can be refused without owing anyone a refund.
--
-- Credits still never expire. Nothing in this file touches the ledger.
-- ===========================================================================

insert into public.app_settings (key, value) values
  ('admin_notify_email',  '""'::jsonb),
  ('admin_notify_signup', 'true'::jsonb),
  ('admin_notify_plan',   'true'::jsonb),
  ('admin_notify_topup',  'true'::jsonb)
on conflict (key) do nothing;

-- No function is created or recreated here, so there is no SECURITY DEFINER
-- grant to close. Said out loud because every recent migration in this
-- directory ends with that revoke, and its absence should read as "there is
-- nothing to revoke" rather than as an omission.

comment on table public.app_settings is
  'Platform-wide settings, one row per key. admin_notify_email is the internal address business events are announced to and is never rendered to a customer; support_email is the published one.';
