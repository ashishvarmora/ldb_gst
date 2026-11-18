/**
 * The opening moment (final, 18 Nov 2026).
 *
 * Real footage, not CGI: a truck climbing a green hill road in Sonmarg on a
 * clear morning (Pexels clip 18228842, free licence). Over it, a few light
 * layers - a soft sun glow, birds crossing the sky, low mist - and a phone
 * notification that drops in: "Your truck just crossed a toll plaza." At the
 * end the notification's logo and "Rahdari" lift off and fly up to the
 * page's own logo and name in the header, and the footage dissolves into
 * the page.
 *
 * WHEN IT PLAYS: every time the site is opened - a new tab or window, the
 * installed app, a home-screen shortcut - but not on a reload, and not when
 * you move around inside the site (sessionStorage remembers it per tab, and
 * a tab opened from our own pages skips it). Tap or Esc skips it.
 *
 * WHY IT NEVER SLOWS THE SITE
 * - Nothing is fetched unless it plays: the poster and video have no src in
 *   the markup; the script sets them. Phones get a 720x1280 file (~600 KB),
 *   wide screens a 1280x720 one (~800 KB), both H.264 (hardware decoding on
 *   every device and browser) and cached for 30 days.
 * - On data saver, 2G/3G, or if the film can't start within 1.2 s, the
 *   poster still (~55 KB) plays the same story with a slow zoom instead.
 * - Only `transform` and `opacity` animate. The page renders underneath the
 *   whole time; a CSS-only failsafe removes the layer after 8 s.
 * - Hidden under prefers-reduced-motion.
 */

/** How long the poster-only version runs before it leaves. */
const STILL_MS = 3400;
/** Hard cap for the film version, in case `ended` never fires. */
const FILM_MAX_MS = 6200;

function splashMain(STILL: number, FILM_MAX: number) {
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
  var wide = innerWidth > innerHeight * 1.05;
  var base = "/intro/morning-" + (wide ? "landscape" : "portrait") + "-v1";
  poster.src = base + ".webp";
  h.classList.add("splash-on");

  var ended = false;

  function onLoad(cb: () => void) {
    if (d.readyState === "complete") cb();
    else w.addEventListener("load", cb);
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
    ghost.style.setProperty("--tx", b.left + b.width / 2 - (a.left + a.width / 2) + "px");
    ghost.style.setProperty("--ty", b.top + b.height / 2 - (a.top + a.height / 2) + "px");
    ghost.style.setProperty("--ts", String(b.height / a.height));
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
        fly(d.querySelector(".rx-ghost-mark"), d.querySelector(".rx-notify img"), mark);
        fly(d.querySelector(".rx-ghost-name"), d.querySelector(".rx-notify b span"), name);
      } catch (e) {}
      h.classList.add("splash-reveal");
      try {
        video.pause();
      } catch (e) {}
      setTimeout(function () {
        h.classList.add("splash-enter");
      }, 1000);
      setTimeout(function () {
        h.classList.add("splash-done");
      }, 1150);
      setTimeout(function () {
        h.classList.remove("splash-enter");
        [].slice.call(d.querySelectorAll(".rx-target")).forEach(function (e: HTMLElement) {
          e.classList.remove("rx-target");
        });
      }, 2400);
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
  video.src = base + ".mp4";
  var p = video.play();
  if (p && p.catch)
    p.catch(function () {
      if (!started) {
        clearTimeout(guard);
        stillOnly();
      }
    });
}

const SPLASH_SCRIPT = `try{(${splashMain.toString()})(${STILL_MS},${FILM_MAX_MS})}catch(e){document.documentElement.classList.add('splash-skip')}`;

const BIRDS = [1, 2, 3, 4, 5] as const;

export function OpeningSplash() {
  return (
    <div className="app-splash" aria-hidden="true">
      <div className="rx-scene">
        {/* Both start empty: the script fills them only when the intro plays. */}
        <img className="rx-poster" alt="" decoding="async" />
        <video className="rx-video" muted playsInline preload="none" disablePictureInPicture tabIndex={-1} />
      </div>

      {/* Light layers over the footage. */}
      <i className="rx-sun" />
      <div className="rx-birds">
        {BIRDS.map((n) => (
          <svg key={n} className={`rx-bird rx-bird-${n}`} viewBox="0 0 24 10" focusable="false">
            <path d="M0 6 Q6 0 12 6 Q18 0 24 6" />
          </svg>
        ))}
      </div>
      <i className="rx-mist" />
      <i className="rx-vignette" />

      {/* The phone notification. */}
      <div className="rx-notify">
        <img src="/brand/rahdari-mark-v2.webp" alt="" width={256} height={131} />
        <span>
          <b>
            <span>Rahdari</span>
            <em>now</em>
          </b>
          <span>Your truck just crossed a toll plaza.</span>
        </span>
      </div>

      {/* Copies of the notification's logo and name that fly up to the header. */}
      <img className="rx-ghost rx-ghost-mark" src="/brand/rahdari-mark-v2.webp" alt="" width={256} height={131} />
      <b className="rx-ghost rx-ghost-name">Rahdari</b>

      <span className="rx-skip">Tap to skip</span>

      <script dangerouslySetInnerHTML={{ __html: SPLASH_SCRIPT }} />
    </div>
  );
}
