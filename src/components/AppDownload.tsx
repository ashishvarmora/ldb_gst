import { Download, Smartphone } from "lucide-react";

import { buttonClass, cx } from "@/components/ui";

/** Served from public/. next.config.ts makes it a download, not a page. */
export const APK_HREF = "/rahdari.apk";
const APK_SIZE = "5.4 MB";

/**
 * The Android app, offered as a download from the website.
 *
 * THE PLAN IS BOUGHT HERE, NOT IN THE APP. The app is this same site in a
 * WebView, signed in to the same account, so a plan bought on the website is
 * already on the account the moment the app signs in - there is nothing to
 * buy twice and nothing to restore. Saying so up front is the point of the
 * three steps: the question every APK user asks first is "do I pay again".
 *
 * `app-hide`, because inside the app this is an offer to download the thing
 * the reader is already holding.
 */
export function AppDownload({
  signedIn = false,
  className,
}: {
  signedIn?: boolean;
  className?: string;
}) {
  const steps = signedIn
    ? [
        "Download the app and open the file to install it.",
        "If Android asks, allow installing apps from your browser.",
        "Sign in with this same email. Your plan, credits and trucks are already there.",
      ]
    : [
        "Create an account and buy your plan here on the website.",
        "Download the app and open the file to install it. If Android asks, allow installing apps from your browser.",
        "Sign in with the same email. The plan you bought is already on it - nothing to pay again in the app.",
      ];

  return (
    <div className={cx("app-hide panel p-5 sm:p-6", className)}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
          <Smartphone size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-strong">Get the Android app</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Alerts arrive as phone notifications, and every truck is a tap away.
            {signedIn ? null : " Buy your plan on the website, then use it in the app."}
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-muted">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-xs font-semibold tabular-nums text-brand-500">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {/* A plain anchor, not LinkButton: that is next/link, which would try
            to route to the file as a page. */}
        <a
          href={APK_HREF}
          download="Rahdari.apk"
          className={cx(buttonClass("primary"), "justify-center")}
        >
          <Download size={15} />
          Download for Android
        </a>
        <span className="text-center text-xs text-faint sm:text-left">
          APK · {APK_SIZE} · Android only
        </span>
      </div>
    </div>
  );
}
