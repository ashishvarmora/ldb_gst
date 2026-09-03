import { ExternalLink } from "lucide-react";

import { Mono } from "@/components/ui";

/**
 * The three steps that turn "chat id" into a number somebody can paste.
 *
 * Written once and shared, because the same question is asked on three screens
 * - a customer's own settings, the create-account modal, and an account's
 * settings tab - and steps that differ by a word between screens are steps
 * somebody has to reconcile before they can trust either version.
 *
 * Meant to be handed to LabelWithInfo as `info`, so it lives behind the (i)
 * beside the field rather than as a paragraph under it: it is read once, by one
 * person, on the day they set alerts up, and never again.
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
