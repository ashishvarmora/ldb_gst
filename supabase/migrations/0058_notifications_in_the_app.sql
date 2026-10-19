-- ===========================================================================
-- The Android/iOS app gets phone notifications too: FCM tokens live in
-- push_subscriptions, next to the browsers' Web Push subscriptions.
--
-- The app (mobile/) is the live site inside a WebView, and a WebView has no
-- Web Push - no PushManager, no service worker push events - so the settings
-- panel could only say "not in the app yet". The app now registers with
-- Firebase Cloud Messaging through @capacitor/push-notifications, and what it
-- gets back is a registration token instead of an endpoint and two keys.
--
-- ---------------------------------------------------------------------------
-- 1 · WHY THE SAME TABLE AND NOT A SECOND ONE
--
-- Everything that asks "does this officer have a phone set up" - the settings
-- panel's device count, the alert-delivery banner, the tracking sweep's
-- pushDevices - counts push_subscriptions rows. A second table would make every
-- one of those answer "no" for somebody whose only device is the app, and the
-- banner would nag them about a channel that is in fact working. One table with
-- a `kind` keeps those counts right without touching them.
--
-- The token goes in `endpoint`. It is the same thing in both cases: the
-- address a send is made to, minted by the push service for one install,
-- unique, and the thing that comes back "gone" when the app is removed. The
-- unique index from 0054 therefore still means what it says - the same phone
-- signing in as somebody else moves the row rather than duplicating it.
--
-- ---------------------------------------------------------------------------
-- 2 · p256dh AND auth BECOME NULLABLE, BUT ONLY FOR FCM ROWS
--
-- FCM carries the payload itself, so there is nothing to encrypt to. The check
-- below keeps the old guarantee for Web Push rows: a web subscription without
-- both keys could never be delivered and would sit failing every send.
--
-- ---------------------------------------------------------------------------
-- 3 · IDEMPOTENT, BECAUSE npm run migrate RE-RUNS EVERY FILE
--
-- `add column if not exists`, `drop not null` (a no-op the second time) and a
-- guarded constraint. Existing rows are all Web Push and take the default.
-- ===========================================================================

alter table public.push_subscriptions
  add column if not exists kind text not null default 'web';

alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;

do $blk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.push_subscriptions'::regclass
      and conname = 'push_subscriptions_kind_check'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_kind_check
      check (
        kind in ('web', 'fcm')
        and (kind <> 'web' or (p256dh is not null and auth is not null))
      );
  end if;
end $blk$;

comment on column public.push_subscriptions.kind is
  '''web'' for a browser''s Web Push subscription (endpoint + p256dh + auth), ''fcm'' for the Android/iOS app, where endpoint holds the Firebase registration token and the two keys are null.';

-- No grants change: the table is still service-role only (see 0054), and a new
-- column inherits the table's privileges.
