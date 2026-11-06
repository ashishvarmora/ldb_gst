import Link from "next/link";

import { buttonClass } from "@/components/ui";

/**
 * Sends people home rather than to the admin console: this page is reached by
 * customers and signed-out visitors far more often than by an admin, and
 * "Back to the console" was a dead end for everyone except one person.
 */
export default function NotFound() {
  return (
    <main className="theme-light flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="font-mono text-sm text-faint">404</p>
        <h1 className="mt-2 text-lg font-semibold text-strong">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          This page does not exist, or it has been removed.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/" className={buttonClass("secondary")}>
            Go to the home page
          </Link>
          <Link href="/portal" className={buttonClass("ghost")}>
            My account
          </Link>
        </div>
      </div>
    </main>
  );
}
