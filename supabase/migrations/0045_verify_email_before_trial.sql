-- ===========================================================================
-- A free trial needs a mailbox somebody actually owns.
--
-- The trial is already once per account, once per mailbox and once per mobile -
-- trial_claims carries a unique index on each, and trial_email_key() folds
-- Gmail dots and plus-addressing so a.b+again@googlemail.com cannot claim a
-- second one. What none of that proves is that the mailbox EXISTS.
--
-- And email_confirmed_at cannot stand in for it. Sign-up creates the account
-- through the admin API with email_confirm: true, deliberately, because this
-- deployment has no SMTP behind Supabase and a confirmation link would never
-- arrive - so every account is born "confirmed" without anybody having read
-- anything. A guard on that column would be a guard on a constant.
--
-- So: a six-digit code, sent through Resend (which is configured, on a verified
-- domain), stored hashed, and required before the trial is granted. The cost of
-- a fake trial is 15 credits and a truck slot; the cost of this is one email.
--
-- WHY THE CODE IS HASHED. The table is reachable by the service role, which is
-- every server-side query in this app. A plaintext code sitting in a row for
-- ten minutes is a code that a log, a backup or a mis-scoped select hands to
-- somebody who never received the email. sha256 of the code plus the user id -
-- salted per user so two people who happen to receive 481920 do not share a
-- hash - and pg_catalog.sha256 rather than pgcrypto's digest(), because
-- pgcrypto lives in the extensions schema on Supabase and a SET search_path
-- function cannot see it. That exact mistake once broke every sign-up on this
-- platform.
-- ===========================================================================

create table if not exists public.email_verifications (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  /* The mailbox the code was sent to, normalised the same way trial_claims
     normalises: verifying one spelling must verify the mailbox, not the
     spelling. */
  email_key    text not null,
  code_hash    text not null,
  /* Wrong guesses. Six digits is a million possibilities, but a code that can
     be guessed forever is a four-hour brute force, so the row dies at five. */
  attempts     integer not null default 0,
  sent_at      timestamptz not null default now(),
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.email_verifications is
  'One in-flight email verification per account. Holds a hash of the code, never the code.';

create index if not exists email_verifications_key_idx
  on public.email_verifications (email_key) where verified_at is not null;

alter table public.email_verifications enable row level security;
-- No policy: the service role reaches it, nobody else. A customer must not be
-- able to read their own row - the hash is in it.

-- ---------------------------------------------------------------------------
-- The hash, in one place so the issuer and the checker cannot disagree
-- ---------------------------------------------------------------------------
create or replace function public.email_code_hash(p_user uuid, p_code text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select encode(sha256(convert_to(p_user::text || ':' || btrim(p_code), 'utf8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Issue a code. Returns it ONCE, to be emailed and then forgotten.
-- ---------------------------------------------------------------------------
create or replace function public.issue_email_code(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_email text;
  v_code  text;
  v_row   public.email_verifications;
begin
  select lower(btrim(email)) into v_email from public.profiles where id = p_user;
  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;

  select * into v_row from public.email_verifications where user_id = p_user;

  -- Already done. Saying so is not a leak: the caller is the account holder.
  if v_row.verified_at is not null and v_row.email_key = public.trial_email_key(v_email) then
    return jsonb_build_object('ok', true, 'already_verified', true);
  end if;

  /*
   * One code a minute. The Server Action rate-limits the endpoint too, but this
   * is the floor that holds even if somebody reaches the function another way -
   * and it is what stops a mailbox being used to flood somebody's inbox.
   */
  if v_row.user_id is not null and v_row.sent_at > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'too_soon',
      'retry_after_seconds', ceil(extract(epoch from (v_row.sent_at + interval '60 seconds' - now()))));
  end if;

  -- Six digits, never starting with a zero so the length is unambiguous when
  -- somebody reads it aloud or a spreadsheet eats the leading character.
  v_code := (100000 + floor(random() * 900000))::int::text;

  insert into public.email_verifications
    (user_id, email_key, code_hash, attempts, sent_at, expires_at, verified_at)
  values
    (p_user, public.trial_email_key(v_email), public.email_code_hash(p_user, v_code),
     0, now(), now() + interval '10 minutes', null)
  on conflict (user_id) do update set
    email_key   = excluded.email_key,
    code_hash   = excluded.code_hash,
    attempts    = 0,
    sent_at     = excluded.sent_at,
    expires_at  = excluded.expires_at,
    verified_at = null;

  return jsonb_build_object('ok', true, 'code', v_code, 'email', v_email,
    'expires_in_minutes', 10);
end $$;

-- ---------------------------------------------------------------------------
-- Check a code
-- ---------------------------------------------------------------------------
create or replace function public.verify_email_code(p_user uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.email_verifications;
begin
  /* FOR UPDATE, so two submissions cannot each read attempts = 4 and both be
     allowed a fifth. */
  select * into v_row from public.email_verifications where user_id = p_user for update;

  if v_row.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_sent');
  end if;
  if v_row.verified_at is not null then
    return jsonb_build_object('ok', true, 'already_verified', true);
  end if;
  if v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_row.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_row.code_hash <> public.email_code_hash(p_user, p_code) then
    update public.email_verifications set attempts = attempts + 1 where user_id = p_user;
    return jsonb_build_object('ok', false, 'reason', 'wrong_code',
      'attempts_left', 5 - (v_row.attempts + 1));
  end if;

  update public.email_verifications
  set verified_at = now(), code_hash = '', attempts = 0
  where user_id = p_user;

  return jsonb_build_object('ok', true, 'verified', true);
end $$;

comment on function public.verify_email_code(uuid, text) is
  'Checks a code and marks the mailbox verified. Clears the hash on success so a used code cannot be replayed.';

-- ---------------------------------------------------------------------------
-- Has this account proved its mailbox?
-- ---------------------------------------------------------------------------
create or replace function public.email_is_verified(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  /*
   * Matched on the mailbox the code was sent to, not merely on the row
   * existing. Otherwise verifying one address and then changing the profile's
   * email would carry the proof across to a mailbox nobody has read.
   */
  select exists (
    select 1
    from public.email_verifications v
    join public.profiles p on p.id = v.user_id
    where v.user_id = p_user
      and v.verified_at is not null
      and v.email_key = public.trial_email_key(lower(btrim(p.email)))
  );
$$;

-- ---------------------------------------------------------------------------
-- The trial now requires it
-- ---------------------------------------------------------------------------
-- Rebuilt from the live definition rather than from an older migration, with
-- one guard added above the claim insert. Everything else - has_plan, had_plan,
-- has_paid, and the three unique keys on trial_claims - is unchanged.
do $blk$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'start_free_trial';

  if v_def is null then
    raise exception 'start_free_trial() is missing - 0035 has not been applied';
  end if;

  if position('email_is_verified' in v_def) > 0 then
    return;  -- already carries the guard
  end if;

  /*
   * Injected immediately before the claim is written, so it sits after the
   * cheap "you already have a plan" checks and before anything is granted.
   * Textual, because the alternative is restating a function another migration
   * owns and letting the two drift - the failure this repo has already had
   * twice with settle_payment.
   */
  v_def := replace(
    v_def,
    'insert into public.trial_claims',
    'if not public.email_is_verified(p_user) then' || chr(10) ||
    '    return jsonb_build_object(''ok'', false, ''reason'', ''email_unverified'');' || chr(10) ||
    '  end if;' || chr(10) || chr(10) ||
    '  insert into public.trial_claims'
  );
  execute v_def;
end $blk$;

-- ---------------------------------------------------------------------------
-- Who may call any of this
-- ---------------------------------------------------------------------------
do $blk$
declare fn text;
begin
  foreach fn in array array[
    'public.email_code_hash(uuid, text)',
    'public.issue_email_code(uuid)',
    'public.verify_email_code(uuid, text)',
    'public.email_is_verified(uuid)',
    'public.start_free_trial(uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $blk$;

revoke all on public.email_verifications from public;
revoke all on public.email_verifications from anon, authenticated;
grant select, insert, update, delete on public.email_verifications to service_role;
