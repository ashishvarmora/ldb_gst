import { ExternalLink } from "lucide-react";

import { HelpNote } from "@/components/Disclosure";
import { Mono } from "@/components/ui";

/**
 * The three steps that turn "chat id" into a number somebody can paste.
 *
 * Written once and shared, because the same question is asked on three screens
 * - a customer's own settings, the create-account modal, and an account's
 * settings tab - and steps that differ by a word between screens are steps
 * somebody has to reconcile before they can trust either version.
 *
 * Just the steps, with no trigger of its own, because the two screens want
 * different triggers: an admin filling this in for somebody gets it behind the
 * (i) beside the field (LabelWithInfo's `info`), and the customer setting their
 * own alerts up gets the labelled dropdown below - see TelegramChatIdHelp.
 *
 * The bot is a real anchor and not @userinfobot in prose, because the whole
 * difficulty here is finding the bot at all - a t.me link opens the app straight
 * on the right conversation, and typing the name into Telegram's search turns up
 * a row of imitations with the same avatar.
 */
export function TelegramChatIdInfo() {
  return (
    <>
      <ol className="space-y-1.5">
        <li className="flex gap-2">
          <span className="font-mono text-brand-500">1.</span>
          <span>
            Open{" "}
            <a
              href="https://t.me/userinfobot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-500 hover:underline"
            >
              t.me/userinfobot
              <ExternalLink size={11} />
            </a>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-brand-500">2.</span>
          <span>
            Press <strong className="text-ink">Start</strong>. It replies with an{" "}
            <strong className="text-ink">Id</strong> — a plain number.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-brand-500">3.</span>
          <span>Paste that number here and save.</span>
        </li>
      </ol>
      {/* The step nobody thinks of, and the one that makes a correct chat id
          look broken: Telegram lets a bot message only someone who started it. */}
      <span className="mt-2 block text-faint">
        The alerts bot needs a <Mono className="text-[11px]">/start</Mono> as well, or it is not
        allowed to send anything.
      </span>
    </>
  );
}

/**
 * The same steps, as a dropdown a customer can see is there.
 *
 * An (i) is right for a detail somebody might want and wrong for this. Nobody
 * owns a "chat id" before we ask for one, so the instructions are not optional
 * reading - they are the only route through the field - and an (i) is a thing
 * you only click if you already suspect it exists. The owner watched people on
 * the live page miss it entirely and asked for the FAQ dropdown instead, which
 * is the right call: a labelled question announces that there is an answer.
 *
 * HelpNote and not Disclosure, because a bordered card here would carry more
 * weight than the field it belongs to. Under the input rather than beside the
 * label, so opening it pushes nothing the reader is using out from under them.
 */
export function TelegramChatIdHelp({ className }: { className?: string }) {
  return (
    <HelpNote title="How do I get my chat id?" className={className}>
      <TelegramChatIdInfo />
    </HelpNote>
  );
}
