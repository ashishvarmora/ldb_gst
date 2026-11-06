/**
 * The name of the cookie that carries a password-reset token from the link in
 * the email to the form that spends it.
 *
 * Its own module because three places need to agree on it - the route that
 * writes it, the page that decides whether to show the form, and the action
 * that spends and clears it - and because a `route.ts` file may only export
 * HTTP handlers, so it could not live beside the code that sets it.
 *
 * See src/app/auth/recover/route.ts for why the token travels this way.
 */
export const RECOVERY_COOKIE = "rahdari-recovery";

/**
 * A hashed recovery token is hex - 56 characters from this project today, but
 * the range is deliberately loose because that length is GoTrue's business and
 * has changed before. Anything else was mangled in transit, or is a missing
 * cookie, which reads the same way here on purpose.
 *
 * A type predicate rather than a plain boolean so that one check does both
 * jobs: callers get `string` afterwards instead of `string | null`, and there is
 * no second test written only to convince the compiler. TypeScript carries the
 * narrowing through a `const` result, so `if (looksRight)` is enough.
 */
export function looksLikeRecoveryToken(value: string | undefined | null): value is string {
  return typeof value === "string" && /^[0-9a-f]{16,128}$/i.test(value);
}

/**
 * Set once the recovery token has been spent and the reader is signed in on
 * the strength of it, holding that user's id; cleared when the password is
 * saved.
 *
 * It exists because spending the token and saving the password are two calls,
 * and Supabase can refuse the second after the first has succeeded - a password
 * it thinks too weak, for instance. Before this cookie, that refusal burned the
 * link: the token was gone, the form was still on screen, and whatever the
 * reader typed next was answered with "this link has expired". A live customer
 * went round that loop twice on 6 Nov 2026 and gave up.
 *
 * It grants nothing by itself. The action only honours it when the Supabase
 * session in the same browser belongs to the same user id - and a signed-in
 * user may set their own password through Supabase anyway. All it does is keep
 * the form on screen for the person the link was sent to.
 */
export const RECOVERY_VERIFIED_COOKIE = "rahdari-recovery-ok";

/** Long enough to read an error and type another password, no longer. */
export const RECOVERY_VERIFIED_TTL_SECONDS = 15 * 60;

/** A Supabase user id. Anything else in that cookie is ignored. */
export function looksLikeUserId(value: string | undefined | null): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
