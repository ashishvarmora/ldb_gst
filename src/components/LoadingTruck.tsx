/**
 * The page-loading hint (rebuilt 17 Nov 2026).
 *
 * Tiered so it suits both a quick load and a slow one:
 *   - under ~0.9 s: nothing extra - only the thin bar at the top (NavProgress)
 *     and the page's placeholder blocks, so a fast page never flashes anything;
 *   - after ~0.9 s: a small pill rises at the bottom of the page - a toll
 *     barrier lifts, a truck drives through, "Loading…";
 *   - after ~4 s: the text changes to "Still loading…" so a slow network feels
 *     acknowledged rather than stuck.
 * No blur and no veil: the page stays readable and the placeholders keep
 * doing their job behind it.
 *
 * WHEN IT SHOWS. Nothing here decides that. It is rendered once by the portal
 * and admin layouts and is `display: none` until loading-truck.css sees either
 * of the two things that already mean "loading" in this app: the navigation
 * bar (NavProgress) or a placeholder block (Skeleton) inside <main>. The
 * delays restart each time it is shown, because an element going from
 * `display: none` to visible starts its animations afresh.
 *
 * Cost: one tiny inline SVG, CSS only (transform and opacity), no script, no
 * state. It never takes a tap and is hidden from screen readers - the
 * placeholders and the bar already say "loading".
 */
export function LoadingTruck() {
  return (
    <div className="loading-truck" aria-hidden="true">
      <div className="lt-pill">
        <svg viewBox="0 0 64 26" role="presentation" focusable="false">
          <line className="lt-road" x1="2" y1="22.5" x2="62" y2="22.5" />
          <line className="lt-lane" x1="2" y1="22.5" x2="62" y2="22.5" />
          <defs>
            <radialGradient id="lt-glow">
              <stop offset="0" stopColor="#fff4d6" stopOpacity="0.95" />
              <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g className="lt-truck">
            <ellipse cx="28" cy="17.4" rx="7" ry="2.6" fill="url(#lt-glow)" />
            <rect className="lt-box" x="0" y="9" width="14" height="10" rx="1.6" />
            <path className="lt-cab" d="M15 12h4.2c.6 0 1.1.3 1.4.8l1.9 3.1c.2.3.3.6.3 1V19H15z" />
            <circle cx="22.4" cy="17.2" r="0.9" fill="#fff4d6" />
            <circle className="lt-wheel" cx="4" cy="19.6" r="2.3" />
            <circle className="lt-wheel" cx="18.6" cy="19.6" r="2.3" />
          </g>
          <rect className="lt-post" x="40" y="12" width="2.6" height="10.5" rx="0.8" />
          <circle className="lt-red" cx="41.3" cy="9.6" r="1.5" fill="#ff4d4f" />
          <circle className="lt-green" cx="41.3" cy="9.6" r="1.5" fill="#2ecc71" />
          <g className="lt-arm">
            <rect x="24" y="12.6" width="17" height="2.4" rx="1.2" fill="#ffffff" stroke="#c9d6ea" strokeWidth="0.4" />
            <rect x="27" y="12.6" width="3" height="2.4" fill="#e5383b" />
            <rect x="33" y="12.6" width="3" height="2.4" fill="#e5383b" />
          </g>
        </svg>
        <span className="lt-text">
          <span className="lt-text-a">Loading…</span>
          <span className="lt-text-b">Still loading…</span>
        </span>
      </div>
    </div>
  );
}
