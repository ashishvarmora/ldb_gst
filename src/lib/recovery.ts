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
