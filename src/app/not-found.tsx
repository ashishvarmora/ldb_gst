import Link from "next/link";

import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="theme-light flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="font-mono text-sm text-faint">404</p>
        <h1 className="mt-2 text-lg font-semibold text-strong">Not found</h1>
        <p className="mt-2 text-sm text-muted">
          That page, officer or plan does not exist — it may have been deleted.
        </p>
        <div className="mt-6">
          <Link href="/admin" className={buttonClass("secondary")}>
            Back to the console
          </Link>
        </div>
      </div>
    </main>
  );
}
