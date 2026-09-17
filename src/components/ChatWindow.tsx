"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Clock, Loader2, Send } from "lucide-react";

import { cx } from "@/components/ui";
import type { ChatMessage } from "@/lib/chat";
import { fmtDayTime, fmtTime } from "@/lib/format";
import type { ActionResult } from "@/lib/types";

/**
 * One conversation, used by both sides.
 *
 * The customer's support page and the admin's console render the same component
 * with different actions passed in. That is deliberate: the two halves of a
 * conversation that look different are two halves that will eventually disagree
 * about what a message is, and there is nothing about this screen that needs to
 * differ by who is reading it.
 *
 * WHY POLLING AND NOT A SOCKET. Supabase Realtime would need this table exposed
 * to a browser key with RLS policies deciding who may read whose conversation,
 * and the table is deliberately unreachable that way - see 0056. A four-second
 * poll of one indexed query, only while the tab is actually in front of
 * somebody, is a support chat that feels immediate at a fraction of the moving
 * parts. The phone notification is what covers the case where nobody is
 * looking, and that is the case that actually matters.
 */

const POLL_MS = 4000;

/** Optimistic rows carry this until the server hands back the real one. */
const PENDING_PREFIX = "pending-";

/**
 * The tick, the way every messaging app draws it - and only claiming what is
 * actually known.
 *
 * WhatsApp has three states because it has a delivery receipt from the device.
 * There is no such receipt here: a web push is handed to Google's or Apple's
 * push service and nothing comes back to say a phone took it. Drawing two grey
 * ticks for "delivered" would therefore be a guess, and the one thing a read
 * receipt must never be is a guess. So there are two honest states plus the
 * moment before either:
 *
 *   clock        in flight - typed, not yet acknowledged by the server
 *   one tick     stored. It exists and the other side can load it
 *   two ticks    they opened the conversation with it on screen
 */
function Ticks({ id, readAt }: { id: string; readAt: string | null }) {
  if (id.startsWith(PENDING_PREFIX)) {
    return <Clock size={12} aria-label="Sending" className="opacity-60" />;
  }
  if (readAt) {
    /*
     * Full white against the 75% the timestamp beside it is set at. WhatsApp
     * turns this blue, which works there because the bubble is pale - on a
     * blue bubble a blue tick is the one combination that disappears. The
     * glyph carries the meaning either way, one tick against two; the
     * brightness is what makes it readable at a glance rather than a thing to
     * squint at.
     */
    return <CheckCheck size={14} aria-label="Read" className="text-white" />;
  }
  return <Check size={14} aria-label="Sent" className="opacity-60" />;
}

/**
 * A short two-note chime when a message arrives while the window is open.
 *
 * Synthesised rather than a file: it is about forty lines of nothing, needs no
 * asset fetched over a phone connection, and cannot 404 after a deploy. Built
 * on first use because a browser refuses to create an AudioContext before the
 * page has been interacted with, and resumed each time because it is suspended
 * whenever the tab goes to the background.
 *
 * Every step is guarded. A device with no Web Audio, a muted tab or a refused
 * autoplay policy must cost nothing more than silence - the notification and
 * the badge are what carry the message; this is the flourish on top.
 */
let audioContext: AudioContext | null = null;

function playChime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    audioContext ??= new Ctor();
    const context = audioContext;
    if (context.state === "suspended") void context.resume();

    const now = context.currentTime;
    // Two rising notes, ~90ms apart. Short enough not to be a nuisance on the
    // twentieth message of a conversation.
    for (const [index, frequency] of [880, 1170].entries()) {
      const at = now + index * 0.09;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      // A ramp rather than a square start and stop, which clicks.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.09, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.18);
    }
  } catch {
    /* Silence is an acceptable outcome. */
  }
}

export function ChatWindow({
  initial,
  viewerRole = "customer",
  poll,
  send,
  onSeen,
  hiddenFields = {},
  placeholder,
  emptyTitle,
  emptyBody,
  keepDays,
}: {
  initial: ChatMessage[];
  /**
   * Which side is reading. Only the optimistic row needs it - every other
   * message arrives from the server with `mine` already decided - but a row
   * that claims the wrong author is a row that renders on the wrong side of
   * the screen the moment anything starts reading senderRole.
   */
  viewerRole?: "customer" | "admin";
  poll: () => Promise<ChatMessage[]>;
  send: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  /**
   * Clears the unread badge. Called when the conversation is opened and again
   * whenever a message arrives while it is actually on screen - reading a
   * message as it lands is still reading it, and a badge that survives that is
   * one somebody has to go and dismiss by hand.
   */
  onSeen?: () => Promise<void>;
  /** e.g. the customer's id, when an admin is writing into their conversation. */
  hiddenFields?: Record<string, string>;
  placeholder: string;
  emptyTitle: string;
  emptyBody: string;
  keepDays: number;
}) {
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  /* Read by the poll loop, which is registered once. Without the ref it would
     have to be torn down and rebuilt on every message that arrives. */
  const countRef = useRef(messages.length);
  countRef.current = messages.length;

  /**
   * Stay at the bottom, but only if that is where the reader already was.
   *
   * Yanking somebody to the newest message while they are reading back through
   * the week is the single most irritating thing a chat window can do, so the
   * scroll only follows when they are within a screen of the end.
   */
  const scrollToEnd = useCallback((force = false) => {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (force || distanceFromBottom < 240) {
      list.scrollTop = list.scrollHeight;
    }
  }, []);

  // First paint lands at the newest message, like opening any messaging app,
  // and opening it is what clears the badge.
  useEffect(() => {
    scrollToEnd(true);
    void onSeen?.();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      // A hidden tab costs a query every four seconds and shows nobody
      // anything. The notification is what reaches them when they are away.
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const next = await poll();
        if (cancelled) return;
        const grew = next.length !== countRef.current;
        setMessages(next);
        if (grew) {
          /*
           * Chime only for THEIR messages. The poll that lands right after you
           * send replaces your optimistic row with the server's, which grows
           * the list by nothing and must not make a noise at yourself.
           */
          const newest = next[next.length - 1];
          if (newest && !newest.mine) playChime();

          scrollToEnd();
          // It arrived while they were looking at it, so it has been read.
          // Without this the badge lights up behind an open conversation.
          void onSeen?.();
        }
      } catch {
        /* A dropped poll is not worth a message on screen - the next one is
           four seconds away, and the send path reports its own failures. */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    const timer = window.setInterval(() => void refresh(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll, scrollToEnd, onSeen]);

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);

    /*
     * The box empties immediately and the message appears at once, because a
     * chat that waits for a server round trip before showing what you typed
     * feels broken on a phone. The temporary row is replaced wholesale by the
     * server's copy below; if the send fails, it is removed and the text is put
     * back in the box rather than lost.
     */
    const optimistic: ChatMessage = {
      id: `${PENDING_PREFIX}${Date.now()}`,
      body,
      senderRole: viewerRole,
      createdAt: new Date().toISOString(),
      readAt: null,
      mine: true,
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    requestAnimationFrame(() => scrollToEnd(true));

    try {
      const fd = new FormData();
      for (const [key, value] of Object.entries(hiddenFields)) fd.set(key, value);
      fd.set("body", body);

      const result = await send(null, fd);
      if (!result.ok) {
        setMessages((current) => current.filter((m) => m.id !== optimistic.id));
        setDraft(body);
        setError(result.error);
        return;
      }
      setMessages(await poll());
      scrollToEnd(true);
    } catch {
      setMessages((current) => current.filter((m) => m.id !== optimistic.id));
      setDraft(body);
      setError("That message did not send. Check your connection and try again.");
    } finally {
      setSending(false);
      boxRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-3"
        aria-live="polite"
        aria-label="Messages"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <p className="text-sm font-medium text-ink">{emptyTitle}</p>
            <p className="mt-1 max-w-sm text-sm text-muted">{emptyBody}</p>
          </div>
        ) : (
          messages.map((message, index) => {
            // A date separator only when the day actually changes, so a
            // conversation held in one afternoon has none at all.
            const previous = messages[index - 1];
            const newDay =
              !previous ||
              new Date(previous.createdAt).toDateString() !==
                new Date(message.createdAt).toDateString();

            return (
              <div key={message.id}>
                {newDay ? (
                  <p className="py-2 text-center text-[11px] text-faint">
                    {fmtDayTime(message.createdAt).split(",")[0]}
                  </p>
                ) : null}
                <div className={cx("flex", message.mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cx(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 sm:max-w-[70%]",
                      message.mine
                        ? "rounded-br-sm bg-brand-500 text-on-brand"
                        : "rounded-bl-sm border border-line bg-panel text-ink",
                    )}
                  >
                    {/* pre-wrap, so the line breaks somebody typed survive, and
                        break-words so a pasted registration number or URL
                        cannot push the bubble past the screen. */}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {message.body}
                    </p>
                    {/* Time and state on one baseline, ticks only on your own
                        messages - a tick beside something they sent you would
                        be telling them whether THEY had read it. */}
                    <p
                      className={cx(
                        "mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums",
                        message.mine ? "text-on-brand/75" : "text-faint",
                      )}
                    >
                      {fmtTime(message.createdAt)}
                      {message.mine ? <Ticks id={message.id} readAt={message.readAt} /> : null}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error ? (
        <p className="mb-2 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-xs text-bad-500">
          {error}
        </p>
      ) : null}

      <div className="border-t border-divider pt-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={boxRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              /*
               * Enter sends, Shift+Enter makes a new line - the convention
               * every messaging app uses. Not on a touch screen, where Enter is
               * the only way to get a new line at all and the on-screen keyboard
               * has no Shift to hold.
               */
              if (event.key === "Enter" && !event.shiftKey && !matchMedia("(pointer: coarse)").matches) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={placeholder}
            className="field max-h-32 min-h-10 flex-1 resize-y py-2"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending || draft.trim() === ""}
            aria-label="Send"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-on-brand transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Messages are deleted after {keepDays} days.
        </p>
      </div>
    </div>
  );
}
