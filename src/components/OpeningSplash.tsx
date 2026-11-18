/**
 * The opening moment: on a clean white screen a truck drives a short road, each
 * toll point it passes turns green, and a pin lands where it stops. It is the
 * product in two seconds - a truck, toll crossings, a location.
 *
 * HOW IT STAYS OUT OF THE WAY
 *
 * - It plays on every full load of the site (the owner's choice), and never on
 *   a move between pages inside it, because this layout is not re-rendered for
 *   those.
 * - It stays until the story has played (SPLASH_MIN_MS) AND the page has
 *   finished loading, whichever is later: the script at the bottom adds
 *   `splash-done` to the document then, and that class fades it out. On a slow
 *   connection it therefore covers the wait rather than racing past it.
 * - The failsafe needs no script at all: opening-splash.css hides the layer
 *   seven seconds after it appears, whatever JavaScript is or is not doing.
 * - It never takes a tap: `pointer-events: none` for its whole life, so the
 *   page underneath is usable even while it is fading.
 * - Under prefers-reduced-motion, and inside the Android/iOS app (which has
 *   its own native splash), it is not shown at all.
 *
 * A server component with no props and no state: pure markup.
 */
/** How long the story takes: the truck arrives and the pin lands by then. */
const SPLASH_MIN_MS = 3300;

/*
 * Inline, so the clock starts when this markup is parsed - the same moment the
 * CSS animation starts - rather than when the bundle has loaded and hydrated.
 */
const SPLASH_SCRIPT = `try{(function(){var s=Date.now(),d=document;function f(){setTimeout(function(){d.documentElement.classList.add('splash-done')},Math.max(0,${SPLASH_MIN_MS}-(Date.now()-s)))}if(d.readyState==='complete'){f()}else{window.addEventListener('load',f)}})()}catch(e){}`;

export function OpeningSplash() {
  return (
    <div className="app-splash" aria-hidden="true">
      <div className="splash-stage">
        <span className="splash-logo">
          <img src="/brand/rahdari-mark-v2.webp" alt="" width={94} height={48} />
        </span>

        <svg className="splash-scene" viewBox="0 0 320 124" role="presentation" focusable="false">
          <defs>
            {/* userSpaceOnUse: a flat line has no height, and a gradient measured
                against its own box would not be drawn at all. */}
            <linearGradient id="splash-route-fill" gradientUnits="userSpaceOnUse" x1="14" y1="0" x2="306" y2="0">
              <stop offset="0" stopColor="#ffb27a" />
              <stop offset="1" stopColor="#f0681f" />
            </linearGradient>
            <linearGradient id="splash-beam-fill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffb347" stopOpacity="0.6" />
              <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* The road, its lane marks sliding past, and the route being drawn. */}
          <line className="splash-road" x1="14" y1="96" x2="306" y2="96" />
          <line className="splash-lane" x1="14" y1="96" x2="306" y2="96" />
          <line className="splash-route-glow" x1="14" y1="96" x2="306" y2="96" pathLength={1} />
          <line className="splash-route" x1="14" y1="96" x2="306" y2="96" pathLength={1} />

          {/* Three toll points. Each lights green, with a ring, as it is passed. */}
          <g className="splash-toll splash-toll-1">
            <line x1="78" y1="96" x2="78" y2="70" />
            <circle className="splash-toll-ring" cx="78" cy="62" r="9" />
            <circle className="splash-toll-dot" cx="78" cy="62" r="9" />
            <path d="M74 62.200l2.800 2.800 5.400-5.600" />
          </g>
          <g className="splash-toll splash-toll-2">
            <line x1="148" y1="96" x2="148" y2="70" />
            <circle className="splash-toll-ring" cx="148" cy="62" r="9" />
            <circle className="splash-toll-dot" cx="148" cy="62" r="9" />
            <path d="M144 62.200l2.800 2.800 5.400-5.600" />
          </g>
          <g className="splash-toll splash-toll-3">
            <line x1="218" y1="96" x2="218" y2="70" />
            <circle className="splash-toll-ring" cx="218" cy="62" r="9" />
            <circle className="splash-toll-dot" cx="218" cy="62" r="9" />
            <path d="M214 62.200l2.800 2.800 5.400-5.600" />
          </g>

          {/* Where it is now: the pin, and a ripple on the ground under it. */}
          <ellipse className="splash-ripple" cx="298" cy="96" rx="9" ry="3" />
          <g className="splash-pin">
            <path d="M298 42c-8 0-14.500 6.200-14.500 14 0 10.200 14.500 24 14.500 24s14.500-13.800 14.500-24c0-7.800-6.500-14-14.500-14z" />
            <circle cx="298" cy="56" r="5.200" />
          </g>

          {/* The truck. Drawn facing right, wheels on the road at y=96. */}
          <g className="splash-truck">
            <g className="splash-truck-body">
              <path className="splash-beam" d="M54 78l30-7v22l-30-6z" />
              <circle className="splash-ping" cx="26" cy="60" r="7" />
              <circle className="splash-ping splash-ping-2" cx="26" cy="60" r="7" />
              <rect className="splash-truck-box" x="0" y="64" width="34" height="24" rx="4" />
              <rect className="splash-truck-stripe" x="0" y="78" width="34" height="3.500" />
              <path className="splash-truck-cab" d="M36 71h10c1.400 0 2.700.700 3.400 2l4.200 7c.400.700.700 1.500.700 2.400V88H36z" />
              <path className="splash-truck-glass" d="M40.200 74.400h5l3.100 5.200h-8.100z" />
              <rect className="splash-truck-light" x="52.300" y="82" width="2" height="3.200" rx="1" />
            </g>
            <circle className="splash-wheel" cx="11" cy="90.500" r="5.800" />
            <circle className="splash-wheel" cx="44" cy="90.500" r="5.800" />
            <circle className="splash-hub" cx="11" cy="90.500" r="2.100" />
            <circle className="splash-hub" cx="44" cy="90.500" r="2.100" />
          </g>
        </svg>

        <p className="splash-caption">
          Following every crossing
          <span className="splash-dots">
            <i />
            <i />
            <i />
          </span>
        </p>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SPLASH_SCRIPT }} />
    </div>
  );
}
