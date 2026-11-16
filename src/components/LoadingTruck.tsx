/**
 * The truck that keeps driving in the middle of a page while it loads.
 *
 * The same picture as the opening animation, made small and endless: the truck
 * crosses a short road, each toll point turns green as it passes, and it comes
 * round again for as long as the page takes. There is no box and no solid
 * screen: the page behind is softened a little and the truck drives over it.
 *
 * WHEN IT SHOWS. Nothing here decides that. It is rendered once by the portal
 * and admin layouts and is `display: none` until loading-truck.css sees either
 * of the two things that already mean "loading" in this app:
 *   - the navigation bar at the top of the window (NavProgress), or
 *   - a placeholder block (Skeleton) inside <main>.
 * So it appears and disappears with those, with no state, no timer and no
 * script of its own - and a browser too old for `:has()` simply never shows it
 * and keeps the placeholders it always had.
 *
 * It never takes a tap, and it is hidden from screen readers: the placeholders
 * and the bar already say "loading" to anything that needs telling.
 */
export function LoadingTruck() {
  return (
    <div className="loading-truck" aria-hidden="true">
      <div className="loading-truck-card">
        <svg viewBox="0 0 240 64" role="presentation" focusable="false">
          <defs>
            <linearGradient
              id="loading-truck-beam"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0" stopColor="#ffb347" stopOpacity="0.6" />
              <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
            </linearGradient>
            <clipPath id="loading-truck-clip">
              <rect x="-40" y="0" width="320" height="64" />
            </clipPath>
          </defs>

          <line className="lt-road" x1="10" y1="50" x2="230" y2="50" />
          <line className="lt-lane" x1="10" y1="50" x2="230" y2="50" />

          <g className="lt-toll lt-toll-1">
            <line x1="70" y1="50" x2="70" y2="30" />
            <circle cx="70" cy="23" r="7" />
            <path d="M66.800 23.200l2.200 2.200 4.200-4.400" />
          </g>
          <g className="lt-toll lt-toll-2">
            <line x1="120" y1="50" x2="120" y2="30" />
            <circle cx="120" cy="23" r="7" />
            <path d="M116.800 23.200l2.200 2.200 4.200-4.400" />
          </g>
          <g className="lt-toll lt-toll-3">
            <line x1="170" y1="50" x2="170" y2="30" />
            <circle cx="170" cy="23" r="7" />
            <path d="M166.800 23.200l2.200 2.200 4.200-4.400" />
          </g>

          {/* Clipped to the card, so the truck slides in and out at the edges. */}
          <g clipPath="url(#loading-truck-clip)">
            <g className="lt-truck">
              <g className="lt-truck-body">
                <path className="lt-beam" d="M43 37l22-5v16l-22-4z" />
                <rect className="lt-box" x="0" y="26" width="27" height="19" rx="3.200" />
                <rect className="lt-stripe" x="0" y="37" width="27" height="2.800" />
                <path
                  className="lt-cab"
                  d="M28.800 31.600h8c1.100 0 2.200.600 2.700 1.600l3.400 5.600c.300.600.500 1.200.500 1.900V45H28.800z"
                />
                <path className="lt-glass" d="M32.200 34.300h4l2.500 4.200h-6.500z" />
              </g>
              <circle className="lt-wheel" cx="8.800" cy="46.600" r="4.600" />
              <circle className="lt-wheel" cx="35.200" cy="46.600" r="4.600" />
              <circle className="lt-hub" cx="8.800" cy="46.600" r="1.700" />
              <circle className="lt-hub" cx="35.200" cy="46.600" r="1.700" />
            </g>
          </g>
        </svg>
        <p>
          Loading
          <span>
            <i />
            <i />
            <i />
          </span>
        </p>
      </div>
    </div>
  );
}
