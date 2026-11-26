import type { Metadata } from "next";

import { DriverShare } from "./DriverShare";
import { loadDriverView } from "@/lib/live/driver";

/**
 * /d/<token> - the page a driver opens from the owner's WhatsApp message.
 *
 * Public, no login: the token is the credential. Shows only the truck number,
 * the name the owner chose to be shown as, and the driver's own name if the
 * owner typed one. Never indexed.
 *
 * Two kinds of link (src/lib/live/driver.ts): a live-module trip (0079) - then
 * the driver also sees where to go and gets Started / Reached / Delivered
 * buttons - or an old truck-page link (0078), which works exactly as before.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Share live location",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default async function DriverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadDriverView(token);

  if (data.kind !== "ok") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 bg-page px-5 py-10 text-center">
        <h1 className="text-xl font-bold text-strong">
          {data.kind === "revoked" ? "This link has been stopped" : "Link not valid"}
        </h1>
        <p className="text-[15px] text-muted">
          {data.kind === "revoked"
            ? "Yeh link band kar diya gaya hai. Aapki location share nahi ho rahi."
            : "Yeh link sahi nahi hai ya purana ho gaya hai."}
        </p>
        <p className="text-sm text-muted">
          {data.kind === "revoked"
            ? "The owner has stopped location sharing for this link. Nothing is being shared."
            : "Ask the truck owner to send you a new link."}
        </p>
      </main>
    );
  }

  return (
    <DriverShare
      token={token}
      truckNumber={data.truckNumber}
      ownerLabel={data.ownerLabel}
      driverName={data.driverName}
      wasSharing={data.sharing}
      trip={data.trip}
      closed={data.closed}
    />
  );
}
