import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Headset, MessageCircle } from "lucide-react";

import { BackButton } from "@/components/BackButton";

/**
 * The support chat, laid out like a messaging app: one bar at the top - back,
 * who you are talking to, and the guide - then the conversation, and the
 * app's own tab bar still underneath, so the rest of the app is one tap away.
 * Shared by the real conversation and the design preview.
 */
export function SupportChatShell({ children }: { children: ReactNode }) {
  return (
    <section className="support-page" aria-labelledby="support-title">
      <header className="support-head">
        <BackButton fallback="/portal" className="support-back" label="Go back" />
        <span className="support-avatar" aria-hidden>
          <Headset size={21} strokeWidth={2.1} />
        </span>
        <div className="support-head-copy">
          <h1 id="support-title">Rahdari Support</h1>
          <p>Our team replies right here</p>
        </div>
        <Link href="/portal/guide" className="support-guide" aria-label="Open the user guide">
          <BookOpen size={17} strokeWidth={2.1} />
          <span>Guide</span>
        </Link>
      </header>
      <div className="support-conversation">{children}</div>
    </section>
  );
}

export function SupportEmptyState() {
  return (
    <div className="support-empty">
      <span className="support-empty-icon">
        <MessageCircle size={30} strokeWidth={1.6} />
      </span>
      <h3>How can we help?</h3>
      <p>
        Write to us below. Our replies will appear
        <br />
        right here.
      </p>
      <nav aria-label="Support guides">
        <Link href="/guide/trucks">
          Truck tracking
          <ChevronRight size={13} />
        </Link>
        <Link href="/guide/payments">
          Payments
          <ChevronRight size={13} />
        </Link>
        <Link href="/guide/account">
          My account
          <ChevronRight size={13} />
        </Link>
      </nav>
    </div>
  );
}
