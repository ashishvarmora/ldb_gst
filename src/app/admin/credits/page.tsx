import { redirect } from "next/navigation";

/**
 * Credits moved in with plans.
 *
 * They were two pages answering halves of one question - what you sell, and
 * what it costs - so they are now one section with tabs. The route stays
 * because bookmarks, older links and other admin pages still point at it; it
 * lands on the tab that used to be this page.
 *
 * The pack ladder, the rate editors and the credit actions still live in this
 * folder. Only the route moved.
 */
export default function CreditsPage() {
  redirect("/admin/plans?tab=rules");
}
