import { ExternalLink } from "lucide-react";

import { HelpNote } from "@/components/Disclosure";
import { Mono } from "@/components/ui";
import {
  ALERT_BOT_START_URL,
  ALERT_BOT_USERNAME,
  ID_BOT_START_URL,
  ID_BOT_USERNAME,
} from "@/lib/telegram-bot";

/**
 * A bot as a tappable link rather than as a name in prose.
 *
 * Typing either name into Telegram's search returns a row of imitations with
 * the same avatar - @userinfobot in particular has several - so the name is
 * never printed for somebody to retype. The link opens the real conversation.
 */
function BotLink({ username, href }: { username: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium break-all text-brand-500 hover:underline"
    >
      t.me/{username}
      <ExternalLink size={11} className="shrink-0" />
    </a>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="font-mono text-brand-500">{n}.</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * The steps that turn "chat id" into a number somebody can paste - and the
 * second /start that makes the number worth pasting.
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
 * TWO BOTS, BOTH NAMED, IN ORDER. This listed @userinfobot as three steps and
 * then mentioned "the alerts bot" in a faint line underneath, unnamed and
 * unlinked. That reads as a footnote and it is not one: Telegram forbids a bot
 * from messaging anyone who has not started it, so an officer who does every
 * numbered step correctly still gets no alert, ever, and has no way to tell
 * that from a broken product. It is now step 2 of three, with its own link,
 * and each step says what it achieves - because the reason people conflated
 * the two bots is that nothing told them the bots do different jobs.
 *
 * Both Telegram trips come before the paste, so the reader leaves this app
 * once and comes back once. Ordering it id -> paste -> second bot sends them
 * out, back, and out again, and the trip they skip is always the last one.
 */
export function TelegramChatIdInfo() {
  return (
    <ol className="space-y-2">
      <Step n={1}>
        Open <BotLink username={ID_BOT_USERNAME} href={ID_BOT_START_URL} /> and press{" "}
        <strong className="text-ink">Start</strong>. It replies with an{" "}
        <strong className="text-ink">Id</strong> — a plain number.
        <span className="mt-0.5 block text-faint">
          That number is your chat id. This bot only reads it back to you.
        </span>
      </Step>
      <Step n={2}>
        Open <BotLink username={ALERT_BOT_USERNAME} href={ALERT_BOT_START_URL} /> and press{" "}
        <strong className="text-ink">Start</strong> as well.
        <span className="mt-0.5 block text-faint">
          This is the bot your alerts come from. Telegram will not let it message you until you
          have sent it a <Mono className="text-[11px]">/start</Mono>, so skipping this is why a
          correct chat id still delivers nothing.
        </span>
      </Step>
      <Step n={3}>
        Paste the number here and save.
        <span className="mt-0.5 block text-faint">
          Both steps above are needed: the first gives you the number, the second gives us
          permission to use it.
        </span>
      </Step>
    </ol>
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
