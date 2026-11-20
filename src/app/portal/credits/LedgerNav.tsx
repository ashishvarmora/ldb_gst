import Link from "next/link";
import { CreditCard, History, ReceiptText } from "lucide-react";

import { LinkPending } from "@/components/NavPending";

/**
 * Navigation shared by the three account history pages: Credits (what came in
 * and what was used per day), Activity (what was checked, by day and by
 * truck) and Payments (money paid). Each page links to the other two at its
 * foot, so nothing has to be mirrored.
 */

export type LedgerSide = "added" | "used";

/** Credits page half. "Added" is the default: it exists nowhere else. */
export function parseSide(raw: string | undefined): LedgerSide {
  return raw === "used" ? "used" : "added";
}

export type LedgerSibling = "credits" | "activity" | "payments";

const SIBLINGS = [
  { key: "credits", href: "/portal/credits", label: "Credits", icon: ReceiptText },
  { key: "activity", href: "/portal/activity", label: "Activity", icon: History },
  { key: "payments", href: "/portal/payments", label: "Payments", icon: CreditCard },
] as const;

export function LedgerLinks({ current }: { current: LedgerSibling }) {
  return (
    <nav className="hist-siblings" aria-label="Account history">
      {SIBLINGS.filter((item) => item.key !== current).map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href}>
          <LinkPending size={13}>
            <Icon size={13} aria-hidden />
          </LinkPending>
          {label}
        </Link>
      ))}
    </nav>
  );
}
