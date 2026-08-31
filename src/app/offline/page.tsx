import Link from "next/link";
import { CloudOff, RefreshCw } from "lucide-react";

import { buttonClass } from "@/components/ui";

export const metadata = { title: "Offline" };

/**
 * What the service worker shows when a page is asked for and there is no
 * network.
 *
 * Carries nothing about the reader on purpose. This is the one page the worker
 * keeps a copy of, and that copy is shared by every account that uses the
 * device - so a balance or a truck number on it would outlive the session it
 * belonged to. It says what happened and offers the way back, nothing else.
 *
 * The reload is a plain link to /portal rather than a button calling
 * location.reload(): reload would replay this same cached response, while a
 * fresh navigation goes to the network and gets the real page once there is
 * one.
 */
export default function OfflinePage() {
  return (
    <main className="theme-light flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl border border-line bg-raised text-muted">
          <CloudOff size={24} />
        </span>

        <h1 className="mt-5 text-xl font-semibold tracking-tight text-strong">You are offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This app reads live records, so it needs a connection. Your saved trucks and history are
          on the server and untouched.
        </p>

        <Link href="/portal" className={buttonClass("primary", "md", "mt-6 w-full justify-center")}>
          <RefreshCw size={15} />
          Try again
        </Link>
      </div>
    </main>
  );
}
