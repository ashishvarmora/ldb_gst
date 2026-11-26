"use client";

/**
 * The opening moment (v3, 19 Nov 2026): a drone shot over a highway toll plaza.
 *
 * A 5-second CGI film (scripts/intro/build_drone.py, rendered in Blender from
 * CC0 Poly Haven assets): a morning highway through green and mustard fields
 * with wind turbines; the drone glides down to the plaza, the FASTag reader
 * blinks, the signal turns green, the boom lifts, the drone rises over the
 * solar canopy and settles behind the Rahdari truck. A phone notification
 * drops in as the truck crosses: "Your truck just crossed a toll plaza." At
 * the end the logo and name painted on the truck lift off and fly to the
 * header's own logo and name, and the film dissolves into the page.
 *
 * WHEN IT PLAYS: every time the site is opened - a new tab or window, the
 * installed app, a home-screen shortcut - but not on a reload, and not when
 * you move around inside the site (sessionStorage remembers it per tab, and
 * a tab opened from our own pages skips it). Tap or Esc skips it.
 *
 * WHY IT NEVER SLOWS THE SITE
 * - Nothing is fetched unless it plays: the video and still have no src in
 *   the markup; the script sets them. Phones get a 540x960 film (~700 KB)
 *   whose crop follows the truck, small wide screens 960x540 (~700 KB), big
 *   ones 1600x900 (~1.4 MB); all H.264 (hardware decoding everywhere) and
 *   cached for 30 days.
 * - On data saver, 2G/3G, or if the film can't start within 1.2 s, the end
 *   frame as a still (~25-45 KB) plays a short version instead.
 * - Only `transform` and `opacity` animate (plus the flying name's colour).
 *   The page renders underneath the whole time; a CSS-only failsafe removes
 *   the layer after 8 s.
 * - Hidden under prefers-reduced-motion.
 */

/** How long the still-only version runs before it leaves. */
const STILL_MS = 3000;
/** Hard cap for the film version, in case `ended` never fires. */
const FILM_MAX_MS = 6200;

/*
 * Where the truck's logo and name sit in the film's last frame, as fractions
 * of the frame (left, top, right, bottom). Printed by build_drone.py
 * (--mode proj, frame 150); the tall film is cropped at x = 811..1317 of 1600.
 */
const SRC = {
  wide: { mark: [0.5702, 0.5645, 0.6284, 0.6637], name: [0.66, 0.6304, 0.7597, 0.71], aspect: 1600 / 900 },
  tall: { mark: [0.2, 0.5645, 0.384, 0.6637], name: [0.484, 0.6304, 0.8, 0.71], aspect: 540 / 960 },
};

function splashMain(STILL: number, FILM_MAX: number, S: typeof SRC) {
  var d = document;
  var h = d.documentElement;
  var w = window;

  /* Once per tab: a reload, or a tab opened from our own pages, skips it. */
  var skip = false;
  try {
    skip = sessionStorage.getItem("rx-intro") === "1";
    sessionStorage.setItem("rx-intro", "1");
  } catch (e) {}
  try {
    if (d.referrer && new URL(d.referrer).origin === location.origin) skip = true;
  } catch (e) {}
  /* The driver's live-location page (/d/<token>): a phone on mobile data, there to tap one button. */
  if (location.pathname.indexOf("/d/") === 0) skip = true;
  /* Public links opened by someone else (a dealer's /track, a shared /t trip): no intro film. */
  if (location.pathname.indexOf("/track/") === 0 || location.pathname.indexOf("/t/") === 0) skip = true;
  /* Crawlers and speed tools (Lighthouse, PageSpeed) see the page itself,
     so search previews and Core Web Vitals scores never include the intro. */
  if (/bot|crawl|spider|slurp|lighthouse|pagespeed|headlesschrome|preview/i.test(navigator.userAgent) || (navigator as Navigator & { webdriver?: boolean }).webdriver) skip = true;
  if (skip || w.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    h.classList.add("splash-skip");
    return;
  }

  var root = d.querySelector(".app-splash") as HTMLElement | null;
  var v = d.querySelector(".rx-video") as HTMLVideoElement | null;
  var poster = d.querySelector(".rx-poster") as HTMLImageElement | null;
  if (!root || !v || !poster) {
    h.classList.add("splash-skip");
    return;
  }
  var stage = root;
  var video = v;
  var still = poster;
  var wide = innerWidth > innerHeight * 1.05;
  var spec = wide ? S.wide : S.tall;
  var big = innerWidth * (w.devicePixelRatio || 1) >= 1400;
  var film = "/intro/drone-" + (wide ? (big ? "wide" : "wide-sm") : "tall") + "-v1.mp4";
  var stillSrc = "/intro/drone-" + (wide ? "wide" : "tall") + "-v1.webp";
  h.classList.add("splash-on");

  var ended = false;

  function onLoad(cb: () => void) {
    if (d.readyState === "complete") cb();
    else w.addEventListener("load", cb);
  }

  /* A box over part of the film's frame, as laid out on screen (object-fit: cover). */
  function frameBox(b: number[]) {
    var W = innerWidth;
    var H = innerHeight;
    var s = Math.max(W / spec.aspect, H);
    var fw = s * spec.aspect;
    var fh = s;
    var e = d.createElement("i");
    e.className = "rx-src";
    e.style.left = (W - fw) / 2 + b[0] * fw + "px";
    e.style.top = (H - fh) / 2 + b[1] * fh + "px";
    e.style.width = (b[2] - b[0]) * fw + "px";
    e.style.height = (b[3] - b[1]) * fh + "px";
    stage.appendChild(e);
    return e;
  }

  /* A flying copy starts exactly over `from` and ends over `to`. */
  function fly(ghost: HTMLElement | null, from: Element | null, to: Element | null | undefined) {
    if (!ghost) return;
    var a = from && from.getBoundingClientRect();
    var b = to && (to as HTMLElement).getBoundingClientRect();
    if (!a || !b || a.width < 2 || b.width < 2 || b.bottom < 0 || b.top > innerHeight) {
      ghost.style.display = "none";
      return;
    }
    ghost.style.left = a.left + "px";
    ghost.style.top = a.top + "px";
    ghost.style.width = a.width + "px";
    ghost.style.height = a.height + "px";
    if (ghost.tagName === "B") {
      /* size the name to the painted letters, then scale to the header's */
      ghost.style.fontSize = a.height * 0.78 + "px";
      var tf = parseFloat(getComputedStyle(to as HTMLElement).fontSize) || 16;
      ghost.style.setProperty("--ts", String(tf / (a.height * 0.78)));
    } else {
      ghost.style.setProperty("--ts", String(b.height / a.height));
    }
    ghost.style.setProperty("--tx", b.left + b.width / 2 - (a.left + a.width / 2) + "px");
    ghost.style.setProperty("--ty", b.top + b.height / 2 - (a.top + a.height / 2) + "px");
    (to as HTMLElement).classList.add("rx-target");
    var ring = d.createElement("i");
    ring.className = "rx-ring";
    ring.style.left = b.left + b.width / 2 + "px";
    ring.style.top = b.top + b.height / 2 + "px";
    ring.style.width = ring.style.height = Math.max(b.width, b.height) * 1.3 + "px";
    stage.appendChild(ring);
  }

  function finish() {
    if (ended) return;
    ended = true;
    onLoad(function () {
      try {
        var mark = [].slice.call(d.querySelectorAll('img[src*="rahdari-mark"]')).filter(function (i: HTMLElement) {
          var r = i.getBoundingClientRect();
          return !i.closest(".app-splash") && r.width > 8 && r.top < innerHeight && r.bottom > 0;
        })[0] as HTMLElement | undefined;
        var name = mark && mark.parentElement && mark.parentElement.querySelector("span");
        fly(d.querySelector(".rx-ghost-mark"), frameBox(spec.mark), mark);
        fly(d.querySelector(".rx-ghost-name"), frameBox(spec.name), name);
      } catch (e) {}
      h.classList.add("splash-reveal");
      try {
        video.pause();
      } catch (e) {}
      setTimeout(function () {
        h.classList.add("splash-enter");
      }, 1700);
      setTimeout(function () {
        h.classList.add("splash-done");
      }, 1850);
      setTimeout(function () {
        h.classList.remove("splash-enter");
        [].slice.call(d.querySelectorAll(".rx-target")).forEach(function (e: HTMLElement) {
          e.classList.remove("rx-target");
        });
      }, 3100);
    });
  }

  /* Tap, click or Esc skips straight to the hand-off. */
  stage.addEventListener("click", finish);
  w.addEventListener("keydown", function (e) {
    if (e.key === "Escape") finish();
  });

  function stillOnly() {
    try {
      video.removeAttribute("src");
      video.load();
    } catch (e) {}
    still.src = stillSrc;
    h.classList.add("splash-still");
    setTimeout(finish, STILL);
  }

  var conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if ((conn && (conn.saveData || /2g|3g/.test(conn.effectiveType || ""))) || !video.canPlayType("video/mp4")) {
    stillOnly();
    return;
  }

  var started = false;
  var guard = setTimeout(function () {
    if (!started) stillOnly();
  }, 1200);
  video.addEventListener("playing", function () {
    if (started || ended) return;
    started = true;
    clearTimeout(guard);
    h.classList.add("splash-playing");
    setTimeout(finish, FILM_MAX);
  });
  video.addEventListener("ended", finish);
  video.muted = true;
  video.src = film;
  var p = video.play();
  if (p && p.catch)
    p.catch(function () {
      if (!started) {
        clearTimeout(guard);
        stillOnly();
      }
    });
}

const SPLASH_SCRIPT = `try{(${splashMain.toString()})(${STILL_MS},${FILM_MAX_MS},${JSON.stringify(SRC)})}catch(e){document.documentElement.classList.add('splash-skip')}`;

const BIRD = (n: number) =>
  `<svg class="rx-bird rx-bird-${n}" viewBox="0 0 24 10" focusable="false"><path d="M0 6 Q6 0 12 6 Q18 0 24 6"></path></svg>`;

/*
 * The splash's contents as plain HTML, the same markup the JSX version used to
 * produce. It is handed to React as one opaque block on purpose: the script
 * above runs while the page is still loading - before React hydrates - and
 * changes these nodes (the still's src, the ghosts' styles, the rx-src and
 * rx-ring markers it adds). Rendered as React children, every one of those
 * changes was a hydration mismatch (React error #418 in production, on every
 * page where the intro played before hydration finished - slow phones, the
 * still-only version), and React then re-rendered the whole page on the client.
 * React never looks inside dangerouslySetInnerHTML when hydrating, so the
 * script owns this subtree outright.
 */
const SPLASH_HTML =
  /* Both start empty: the script fills them only when the intro plays. */
  `<div class="rx-scene"><img class="rx-poster" alt="" decoding="async"/><video class="rx-video" muted="" playsinline="" preload="none" disablepictureinpicture="" tabindex="-1"></video></div>` +
  /* Light layers over the film. */
  `<div class="rx-birds">${[1, 2, 3, 4].map(BIRD).join("")}</div><i class="rx-vignette"></i>` +
  /* The phone notification, as the truck crosses the plaza. */
  `<div class="rx-notify"><img src="/brand/rahdari-mark-v2.webp" alt="" width="256" height="131"/><span><b><span>Rahdari</span><em>now</em></b><span>Your truck just crossed a toll plaza.</span></span></div>` +
  /* Copies of the truck's logo and name that fly up to the header. */
  `<img class="rx-ghost rx-ghost-mark" src="/brand/rahdari-mark-v2.webp" alt="" width="256" height="131"/><b class="rx-ghost rx-ghost-name"><span class="rx-paint">RAHDARI</span><span class="rx-ink">Rahdari</span></b>` +
  `<span class="rx-skip">Tap to skip</span>` +
  `<script>${SPLASH_SCRIPT}</script>`;

/*
 * One object for the life of the page. React 19 rewrites innerHTML whenever
 * this prop is a different object (it compares by identity, not by __html),
 * which would wipe a playing intro on any router.refresh() or server-action
 * revalidation. That is also why this file is a client component: a server
 * component's props arrive as a fresh object with every RSC payload.
 */
const SPLASH_INNER = { __html: SPLASH_HTML };

export function OpeningSplash() {
  /* suppressHydrationWarning: dev mode compares innerHTML, which the script has changed by then, on purpose. */
  return <div className="app-splash" aria-hidden="true" suppressHydrationWarning dangerouslySetInnerHTML={SPLASH_INNER} />;
}
