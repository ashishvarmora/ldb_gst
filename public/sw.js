/*
 * Service worker. Deliberately the smallest one that makes the app installable.
 *
 * WHAT THIS DOES NOT CACHE, AND WHY IT MUST NOT
 *
 * Every page here is server-rendered against a Supabase auth cookie, and the
 * Cache Storage this worker owns is keyed by ORIGIN, not by user. Caching a
 * rendered page would therefore mean one officer's balance, trucks and records
 * sitting in a cache that the next person to sign in on the same phone can be
 * served from. On a shared device that is a data leak, not a stale page.
 *
 * So: no HTML is cached, no API response is cached, nothing carrying a cookie
 * is cached. The only things kept are content-hashed build assets, which are
 * immutable and hold no user data, and one offline notice.
 *
 * A fetch handler is also what Chrome requires before it will offer to install
 * an app at all, so the offline fallback below is doing double duty.
 *
 * The push handlers at the bottom keep that promise: they read the payload the
 * server encrypted, show a notification and open a window. Nothing on that
 * path touches Cache Storage, and nothing on it fetches anything - so there is
 * no response for it to keep even by accident.
 */

/* Bump to throw away everything the previous worker kept. */
const VERSION = "v3";
const ASSETS = `assets-${VERSION}`;
const SHELL = `shell-${VERSION}`;

const OFFLINE_URL = "/offline";

/** The only HTML this worker is allowed to keep: it has no user data on it. */
const SHELL_URLS = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([ASSETS, SHELL]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Content-hashed build output. The hash is the version, so it never goes stale. */
function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

/** Our own icons and manifest. Small, public, and wanted while offline. */
function isPublicIcon(url) {
  return /^\/(icon-|apple-icon|favicon)/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Anything that changes state stays entirely between the page and the server.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Razorpay's checkout, Supabase's endpoints and every other cross-origin call
  // fall through above. What is left is our own GETs.

  if (isImmutableAsset(url) || isPublicIcon(url)) {
    event.respondWith(cacheFirst(request, isImmutableAsset(url) ? ASSETS : SHELL));
    return;
  }

  /*
   * A page. Always from the network - see the note at the top of this file -
   * and when the network is not there, the offline notice instead of the
   * browser's own error page. Nothing is written to a cache on this path.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          /* One more try before giving up. On Indian mobile data a single
             dropped request is common, and showing "You are offline" for it
             is what made the site look down when it was not. */
          try {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            return await fetch(request);
          } catch {
            /* Really unreachable - fall through to the notice. */
          }
          const cache = await caches.open(SHELL);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ??
            new Response("You are offline.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
  }

  // Everything else - data requests, server action posts' GET siblings, route
  // handlers - is left to the browser untouched.
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Opaque and error responses are not worth keeping, and a partial 206 cannot
  // be replayed from a cache correctly.
  if (response.ok && response.type === "basic") {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/*                                                                            */
/* The half that makes the icon on the home screen buzz. Everything above is   */
/* about what this worker will serve; this is about what it will show, and it  */
/* deliberately shares nothing with it - no cache is opened here.              */
/* -------------------------------------------------------------------------- */

const FALLBACK_URL = "/portal/notifications";

/**
 * A path on this site, whatever arrived.
 *
 * Only our own server can produce a payload this worker will decrypt, so this
 * is not guarding against an attacker - it is guarding against a bug. A wrong
 * value here would send a tapped notification to a page on somebody else's
 * domain, and a phone opening an unexpected site because a lorry moved is not
 * a failure anyone would think to look for in a service worker.
 */
function ownUrl(candidate) {
  if (typeof candidate !== "string" || !candidate) return FALLBACK_URL;
  try {
    const resolved = new URL(candidate, self.location.origin);
    if (resolved.origin !== self.location.origin) return FALLBACK_URL;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return FALLBACK_URL;
  }
}

self.addEventListener("push", (event) => {
  /*
   * A payload we sent, or nothing at all. Some push services send a wake-up
   * with no data, and a browser that gets `userVisibleOnly: true` and then no
   * notification eventually revokes the permission - so the fallback below is
   * a real notification, not a placeholder.
   */
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Not JSON. Whatever it is, something was sent, so say so rather than
    // showing nothing.
    payload = {};
  }

  const title = payload.title || "Truck update";
  const body = payload.body || "Open the app to see what changed.";
  const url = ownUrl(payload.url);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      // The small monochrome mark Android puts in the status bar. It falls back
      // to the icon above where it is not supported, which is everywhere else.
      badge: "/icon-192.png",
      /*
       * One notification per truck, replaced rather than stacked. A lorry
       * crossing four plazas on a night run would otherwise leave four rows to
       * clear, three of which are already out of date. renotify because a
       * replacement that arrives silently is a notification nobody sees.
       */
      tag: payload.tag || "truck-alert",
      renotify: true,
      /*
       * SOUND AND A BUZZ, WHICH IS MOSTLY NOT OURS TO DECIDE.
       *
       * A web push cannot choose its own sound - the OS plays whatever the
       * user has set for the channel, and there is no API to override it. What
       * a page CAN do is avoid the two things that silence one, and both are
       * here: silent:false, and renotify:true above, without which a
       * replacement for a notification already on screen arrives with no sound
       * or buzz at all. That is the case that matters for a chat, where the
       * second message in a conversation reuses the first one's tag.
       *
       * vibrate is honoured on Android and ignored on iOS. A short
       * buzz-pause-buzz reads as a message rather than as the single long
       * pulse an alert gets.
       */
      silent: false,
      vibrate: [180, 80, 180],
      timestamp: Date.now(),
      // Read by notificationclick below. Nothing else is put on it: a
      // notification is stored by the OS and outlives the session.
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Through ownUrl() again rather than trusted: a notification is stored by the
  // OS and can be tapped days after the worker that showed it was replaced.
  const target = new URL(ownUrl(event.notification.data?.url), self.location.origin);

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        // Without this, a window that has not been claimed by this worker
        // version is invisible here and every tap opens a second copy of the
        // app beside the one already open.
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (new URL(client.url).origin !== target.origin) continue;
        /*
         * Focus what is already open and steer it, rather than opening
         * another window. On an installed iPhone app there is only ever one,
         * and openWindow there can land in Safari instead - which is a
         * different context with a different session, so the officer would be
         * asked to sign in to read an alert about their own truck.
         */
        await client.focus();
        if (client.url !== target.href && "navigate" in client) {
          await client.navigate(target.href).catch(() => {
            /* A cross-document navigate can be refused; the window is focused
               either way, which is most of what the tap was for. */
          });
        }
        return;
      }

      await self.clients.openWindow(target.href);
    })(),
  );
});

