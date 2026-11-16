import { CloudOff } from "lucide-react";

import { RetryButton } from "./RetryButton";

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

        <h1 className="mt-5 text-xl font-semibold tracking-tight text-strong">Connection problem</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This phone could not reach Rahdari just now - usually the mobile network. Your trucks and
          history are safe on the server. Check your connection and try again.
        </p>

        <RetryButton />
      </div>
    </main>
  );
}
