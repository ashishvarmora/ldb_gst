/**
 * Which build this server is running.
 *
 * WHAT THIS IS FOR. A browser that loaded the site before a deploy is holding
 * an HTML document that names JavaScript chunks by content hash. After the
 * deploy those hashes are different, and the files the open page still wants
 * are no longer part of the current deployment - so the next thing that page
 * lazy-loads 404s. What the customer sees is not an error page: it is a button
 * that does nothing, or a screen stuck half-rendered, and the only thing that
 * fixes it is a refresh they have no reason to know they need. An installed
 * PWA makes it worse, because it is resumed rather than reloaded and can stay
 * on one document for days.
 *
 * VERCEL_DEPLOYMENT_ID changes on every deployment, which is exactly the
 * granularity that matters: a redeploy of the same commit still invalidates
 * the asset hashes. The commit sha is the fallback for a non-Vercel host, and
 * "dev" locally - where it is deliberately constant, so a dev server never
 * tells itself to reload mid-edit.
 */
export const BUILD_ID =
  process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
