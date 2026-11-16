/**
 * A fetch that gives up after `ms`.
 *
 * Without one, a Supabase request that stalls holds the page or Server Action
 * open until Vercel kills the function - and the customer stares at a spinner
 * that never stops, which reads as "the site is down". With one, the call
 * fails, the action returns its error and the form says what happened.
 *
 * A signal the caller already passed (supabase-js's own abortSignal()) is kept:
 * whichever fires first wins.
 */
export function fetchWithTimeout(ms: number): typeof fetch {
  return (input, init = {}) => {
    const limit = AbortSignal.timeout(ms);
    const signal = init.signal ? AbortSignal.any([init.signal, limit]) : limit;
    return fetch(input, { ...init, signal });
  };
}
