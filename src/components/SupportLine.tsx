import Link from "next/link";
import { LifeBuoy, Mail, MessageSquareWarning, Phone } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * How somebody reaches a human when the product is the thing that is broken.
 *
 * The account menu already had a "Need help?" block, and it was wrapped in
 * `{supportEmail || supportPhone ? ... : null}` - so with both settings blank,
 * which is how this platform is configured RIGHT NOW, a customer who hit a bug
 * had no route to anybody at all. The conditional was defensive about rendering
 * an empty box and ended up defensive about rendering any help.
 *
 * So the rule here is that this never renders nothing. An address and a number
 * are better, and are used when set, but `/contact` always exists and always
 * says whatever the owner has filled in. Degrading to a link beats degrading to
 * silence.
 *
 * WHY IT IS A COMPONENT AND NOT A PAGE
 *
 * A support page nobody can find is the same as no support page. The moment a
 * customer wants it is the moment something surprised them - a search that came
 * back wrong, credits that did not arrive, a truck that stopped reporting - and
 * that moment happens on some other screen. This drops in at the bottom of
 * whichever screen that was.
 */

export type SupportContact = {
  /** Either may be blank; the fallback covers that. */
  email: string;
  phone: string;
};

/** `tel:` wants digits and a leading +, not the spaces people type. */
function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

/**
 * The full block, for a panel or a menu: a heading, then whichever routes
 * exist.
 *
 * `report` adds the "found a bug" framing. It is off by default because on a
 * billing screen the question is "where are my credits", not "is this
 * software broken", and offering the wrong one sends people down the wrong path.
 */
export function SupportPanel({
  support,
  report = false,
  className,
}: {
  support: SupportContact;
  report?: boolean;
  className?: string;
}) {
  const { email, phone } = support;
  const direct = Boolean(email || phone);

  return (
    <div className={className}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        {report ? <MessageSquareWarning size={11} /> : <LifeBuoy size={11} />}
        {report ? "Something wrong?" : "Need help?"}
      </p>

      <div className="mt-2 flex flex-col gap-1.5">
        {email ? (
          <a
            href={`mailto:${email}`}
            className="inline-flex min-h-9 items-center gap-2 text-sm text-brand-500 transition hover:underline"
          >
            <Mail size={14} className="shrink-0" />
            <span className="truncate">{email}</span>
          </a>
        ) : null}

        {phone ? (
          <a
            href={`tel:${dialable(phone)}`}
            className="inline-flex min-h-9 items-center gap-2 text-sm text-brand-500 transition hover:underline"
          >
            <Phone size={14} className="shrink-0" />
            <span className="truncate">{phone}</span>
          </a>
        ) : null}

        {/*
          Always present, and the only thing here when nothing else is set.
          Worded as the way through rather than as a second-best: a customer
          does not need to know the owner has not filled in a phone number.
        */}
        <Link
          href="/contact"
          className={cx(
            "inline-flex min-h-9 items-center gap-2 transition hover:underline",
            direct ? "text-sm text-muted" : "text-sm text-brand-500",
          )}
        >
          <LifeBuoy size={14} className="shrink-0" />
          {direct ? "Other ways to reach us" : "Get in touch"}
        </Link>
      </div>

      {report ? (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Tell us the truck number and roughly when it happened — that is
          usually enough for us to find it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One quiet line, for the foot of a working screen.
 *
 * Deliberately small and grey. It has to be findable when wanted and ignorable
 * when not: a screen that keeps asking whether anything is wrong reads as a
 * product that expects to be broken.
 */
export function SupportLine({
  support,
  className,
}: {
  support: SupportContact;
  className?: string;
}) {
  const { email } = support;

  return (
    <p className={cx("text-xs leading-relaxed text-faint", className)}>
      Something look wrong, or found a bug?{" "}
      {email ? (
        <a href={`mailto:${email}`} className="text-brand-500 transition hover:underline">
          Email us
        </a>
      ) : (
        <Link href="/contact" className="text-brand-500 transition hover:underline">
          Tell us
        </Link>
      )}{" "}
      and we will look into it.
    </p>
  );
}
