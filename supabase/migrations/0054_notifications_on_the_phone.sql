-- ===========================================================================
-- The phone itself buzzes: one row per installed copy of the app.
--
-- The owner, twice: "notification is not showing on mobile as a notification.
-- home screen pe yeh added hai but notification show nahi hoti" and then "app
-- notification mobile me jaana chahiye - fix it and create if not exists. i
-- want that free."
--
-- Nothing was broken. This app had never sent a phone notification of its own:
-- there was a service worker and a manifest, so an installed icon opened full
-- screen, but the worker had no push handler, there was no key pair, no
-- subscription stored anywhere and no sender. Alerts were Telegram messages,
-- which is Telegram's notification and not ours. So this is the missing half,
-- not a repair.
--
-- ---------------------------------------------------------------------------
-- 1 · WHY THIS IS FREE, WHICH WAS THE CONDITION
--
-- Web Push with our own VAPID key pair. The thing that actually delivers the
-- notification is the browser vendor's own push service - FCM for Chrome, APNs
-- for an installed iPhone app, Mozilla's for Firefox - and all three are free
-- and need no account. A key pair generated on a laptop is the whole of the
-- setup. Firebase, OneSignal and Pusher were not considered for longer than it
-- takes to notice each wants a dashboard, a project and eventually a bill for
-- the same bytes the browser will carry for nothing.
--
-- ---------------------------------------------------------------------------
-- 2 · WHY A TABLE AND NOT A COLUMN ON telegram_configs
--
-- A subscription is per INSTALL, not per account, and one officer plausibly has
-- three: the phone, the phone's second browser, and the laptop they do the
-- paperwork on. A single column would mean the last device to subscribe
-- silently turned off the others - and on iOS that is not a hypothetical, since
-- Safari and the home-screen copy of this app are two separate contexts with
-- two separate permissions and two separate subscriptions. The officer would
-- subscribe in the installed app, subscribe again in Safari a week later, and
-- the phone would go quiet with no way to see why.
--
-- The endpoint is the identity, not the user. It is a url the push service
-- minted for one install, it is what a send is addressed to, and it is what
-- comes back as "gone" when the app is deleted. So the unique key is on the
-- endpoint alone rather than on (user_id, endpoint): the same endpoint arriving
-- for a different account means the phone was handed over or a second officer
-- signed in on it, and the row must MOVE rather than be duplicated, or the
-- previous owner keeps receiving that phone's notifications. That is the shared
-- -phone case public/sw.js already refuses to cache HTML for.
--
-- ---------------------------------------------------------------------------
-- 3 · WHAT IS DELIBERATELY NOT HERE
--
-- No is_enabled switch. Telegram has one because a chat id is typed once and
-- kept: switching delivery off without losing the id is a real thing to want.
-- A push subscription is the opposite - the browser owns it, revoking
-- permission destroys it, and the officer's off switch is the OS notification
-- setting and the Unsubscribe button, both of which delete rather than disable.
-- A stored "off" would be a third answer that could disagree with the two real
-- ones, and the first thing anybody would hit is a row saying "on" for a
-- permission the phone withdrew months ago.
--
-- No last_error column either. A push failure is not information about the
-- SUBSCRIPTION, it is information about one send: a 404 or a 410 means the
-- install is gone and the row is deleted on the spot (see src/lib/push.ts), and
-- anything else is transient and already in alert_logs.delivery_error next to
-- the alert it belongs to. A column here would be a second, staler copy of the
-- same fact with nothing reading it.
--
-- No RLS policy. The service role reaches this and nobody else, exactly like
-- email_verifications in 0045. There is nothing on these rows a customer needs
-- to read - the browser holds its own subscription - and the p256dh and auth
-- keys are the credentials a notification is encrypted to.
--
-- ---------------------------------------------------------------------------
-- 4 · IDEMPOTENT, BECAUSE npm run migrate RE-RUNS EVERY FILE
--
-- scripts/push-migrations.mjs applies all fifty-odd files on every run, so
-- everything below is `if not exists` or a guarded do-block. There is no data
-- to backfill and nothing to fold: the table is new, and a second pass must
-- change nothing at all.
-- ===========================================================================

create table if not exists public.push_subscriptions (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  /*
   * The url the push service minted for this install. Long - FCM's run past
   * 200 characters - so no length limit, and text rather than a hash: it is
   * what a send is POSTed to, so it has to survive intact.
   */
  endpoint     text not null,
  /* The install's public key and auth secret. web-push encrypts the payload to
     these, which is why a push service can carry a notification it cannot
     read. */
  p256dh       text not null,
  auth         text not null,
  /*
   * Which install this is, in the only words the browser will give us. Not used
   * for anything the app decides - it is there so "why has my iPhone gone
   * quiet" can be answered by looking at whether the row is the home-screen
   * copy or a Safari tab, which is the single most common cause on iOS.
   */
  user_agent   text,
  created_at   timestamptz not null default now(),
  /* Bumped every time the browser re-subscribes, which it does on its own
     schedule. A row that has not been seen for months is an install that is
     probably gone but has not been declared gone by its push service. */
  last_seen_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'One row per installed copy of the app that has agreed to be notified. Written and read only by the service role. Rows are deleted, never disabled: the browser owns the permission, and a 404 or 410 from the push service means the install is gone.';

comment on column public.push_subscriptions.endpoint is
  'The push service url for one install. Unique across the whole table, not per user: the same phone signing in as somebody else must move the row, or its previous owner keeps getting its notifications.';

/*
 * Unique on the endpoint alone - see section 2. Also what the upsert in
 * savePushSubscription() conflicts on, so it has to exist before that action
 * can store anything.
 */
create unique index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions (endpoint);

/* Every send starts "all subscriptions for this officer", which is the only
   query this table has. */
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
-- No policy, deliberately: see section 3. The service role bypasses RLS, and
-- with RLS on and nothing granted below, the anon and authenticated keys can
-- read nothing here even if one of them reaches the table.

revoke all on public.push_subscriptions from public;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

/*
 * bigserial owns a sequence, and a sequence is a separate object with its own
 * grants: without this an insert as service_role fails on nextval() rather
 * than on the table, which is a confusing place to land. Named through
 * pg_get_serial_sequence rather than spelled out, so a rename cannot leave
 * this pointing at nothing.
 */
do $blk$
declare
  v_seq text := pg_get_serial_sequence('public.push_subscriptions', 'id');
begin
  if v_seq is not null then
    execute format('revoke all on sequence %s from anon, authenticated', v_seq);
    execute format('grant usage, select on sequence %s to service_role', v_seq);
  end if;
end $blk$;

-- No function is created here, so there is no SECURITY DEFINER grant to close.
-- Said out loud because most recent files in this directory end with one, and
-- its absence should read as "there is nothing to revoke" rather than as an
-- omission.
