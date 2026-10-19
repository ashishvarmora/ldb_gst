-- ===========================================================================
-- Announcements: one thing the desk says to many customers at once - a banner
-- across the top of the portal, a popup, a phone notification, or all three.
--
-- The owner wanted a single place to send "announcements, offers, banners and
-- notifications to all users or chosen users, on a schedule and with frequency
-- rules". Before this the only way to tell every customer something was to
-- message them one at a time from /admin/chat.
--
-- ---------------------------------------------------------------------------
-- 1 · TWO TABLES, BOTH NEW
--
-- announcements        what to say, to whom, when, and how often.
-- announcement_views   one row per (announcement, customer) once it has been
--                      shown to them: when first and last, how many times,
--                      and whether they closed it or tapped its button.
--
-- The second table is what makes the frequency rules possible at all - "once"
-- needs to know it has been seen, "daily" needs to know when - and it is also
-- the whole of the admin's stats: seen, dismissed and clicked are counts of
-- these rows. Nothing is written for a customer the announcement never reached,
-- so the table grows with what was shown rather than with audience size.
--
-- 'session' frequency deliberately writes nothing extra: "once each time the
-- app is opened" is the browser's sessionStorage, which the server cannot see
-- and does not need to.
--
-- ---------------------------------------------------------------------------
-- 2 · AUDIENCE IS A KIND PLUS TWO LISTS, NOT A JOIN TABLE
--
-- 'all', 'active_plan' and 'no_plan' need no list. 'plans' reads
-- target_plan_ids and 'users' reads target_user_ids. Arrays rather than a join
-- table because the lists are small, written once from one form, and read whole
-- every time; a join table would be three more queries for the same answer.
-- No foreign key on the array elements (Postgres has none for arrays): a plan
-- or account deleted later simply stops matching, which is the right outcome.
--
-- ---------------------------------------------------------------------------
-- 3 · PUSH IS RECORDED ON THE ROW, SO IT CAN NEVER GO TWICE
--
-- push_sent_at is stamped BEFORE the sends start (see src/lib/announcements.ts),
-- by an update that only matches while it is still null. Two cron ticks, or an
-- admin pressing "Send push now" while the sweep is running, cannot both win
-- that update - so a customer's phone buzzes once per announcement.
--
-- ---------------------------------------------------------------------------
-- 4 · SERVICE ROLE ONLY, LIKE push_subscriptions IN 0054
--
-- RLS on with no policy. The portal reads these through the service role in the
-- layout, already filtered to the signed-in customer, so no customer key ever
-- needs to touch them - and target_user_ids is a list of other people's ids.
--
-- ---------------------------------------------------------------------------
-- 5 · ADDITIVE AND IDEMPOTENT, BECAUSE npm run migrate RE-RUNS EVERY FILE
--
-- Two new tables, `if not exists` throughout, constraints in guarded blocks.
-- No existing table, view or function is changed.
-- ===========================================================================

create table if not exists public.announcements (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  body             text not null default '',
  /* Colour only. 'offer' is the one the owner asked for by name. */
  tone             text not null default 'info',

  /* Where it appears. At least one must be on - see the check below. */
  show_banner      boolean not null default true,
  show_popup       boolean not null default false,
  send_push        boolean not null default false,

  audience         text not null default 'all',
  target_plan_ids  uuid[] not null default '{}',
  target_user_ids  uuid[] not null default '{}',

  /*
   * once     until the customer closes it (or, if it cannot be closed, until
   *          it has been shown once)
   * daily    once per IST calendar day
   * session  each time the site or app is newly opened
   * always   every page, until it ends or is closed
   */
  frequency        text not null default 'once',
  dismissible      boolean not null default true,

  /* The window. starts_at defaults to now so "publish" means now; a null
     ends_at runs until it is paused or deleted. */
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz,

  /* Optional button. A same-site path or an https url - checked in the action,
     and again here so a row written any other way cannot carry javascript:. */
  cta_label        text,
  cta_url          text,

  /* Pause without losing the stats. */
  is_active        boolean not null default true,

  push_sent_at     timestamptz,
  push_sent_count  integer not null default 0,

  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.announcements is
  'Banners, popups and phone notifications the desk sends to many customers at once. Service role only. push_sent_at is stamped once, before sending, so a push can never go twice.';

do $blk$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.announcements'::regclass
                   and conname = 'announcements_tone_check') then
    alter table public.announcements add constraint announcements_tone_check
      check (tone in ('info', 'offer', 'warning', 'success'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.announcements'::regclass
                   and conname = 'announcements_audience_check') then
    alter table public.announcements add constraint announcements_audience_check
      check (audience in ('all', 'active_plan', 'no_plan', 'plans', 'users'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.announcements'::regclass
                   and conname = 'announcements_frequency_check') then
    alter table public.announcements add constraint announcements_frequency_check
      check (frequency in ('once', 'daily', 'session', 'always'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.announcements'::regclass
                   and conname = 'announcements_channel_check') then
    alter table public.announcements add constraint announcements_channel_check
      check (show_banner or show_popup or send_push);
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.announcements'::regclass
                   and conname = 'announcements_window_check') then
    alter table public.announcements add constraint announcements_window_check
      check (ends_at is null or ends_at > starts_at);
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.announcements'::regclass
                   and conname = 'announcements_cta_url_check') then
    alter table public.announcements add constraint announcements_cta_url_check
      check (cta_url is null
             or (cta_url like '/%' and cta_url not like '//%')
             or cta_url like 'https://%');
  end if;
end $blk$;

/* The portal's only question: which are switched on and have started. */
create index if not exists announcements_live_idx
  on public.announcements (starts_at)
  where is_active;

alter table public.announcements enable row level security;
revoke all on public.announcements from public;
revoke all on public.announcements from anon, authenticated;
grant select, insert, update, delete on public.announcements to service_role;


create table if not exists public.announcement_views (
  announcement_id  uuid not null references public.announcements (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  seen_count       integer not null default 1,
  dismissed_at     timestamptz,
  clicked_at       timestamptz,
  primary key (announcement_id, user_id)
);

comment on table public.announcement_views is
  'One row per customer an announcement was actually shown to. Drives the once/daily frequency rules and every number on /admin/announcements. Service role only.';

/* "What has this customer already seen" - the portal reads it on every page. */
create index if not exists announcement_views_user_idx
  on public.announcement_views (user_id);

alter table public.announcement_views enable row level security;
revoke all on public.announcement_views from public;
revoke all on public.announcement_views from anon, authenticated;
grant select, insert, update, delete on public.announcement_views to service_role;

-- No serial column in either table (uuid and a composite key), so there is no
-- sequence to grant - said out loud because 0054 needed one and this should
-- read as "nothing to grant" rather than as an omission. No function either,
-- so no SECURITY DEFINER grant to close.
