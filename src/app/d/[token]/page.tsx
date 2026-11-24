import type { Metadata } from "next";

import { DriverShare } from "./DriverShare";
import { loadDriverPage } from "@/lib/live-location";

/**
 * /d/<token> - the page a driver opens from the owner's WhatsApp message.
 *
 * Public, no login: the token is the credential. Shows only the truck number,
 * the name the owner chose to be shown as, and the driver's own name if the
 * owner typed one. Never indexed.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Share live location",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default async function DriverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadDriverPage(token);

  if (data.kind !== "ok") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 bg-page px-5 py-10 text-center">
        <h1 className="text-xl font-bold text-strong">
          {data.kind === "revoked" ? "This link has been stopped" : "Link not valid"}
        </h1>
        <p className="text-[15px] text-muted">
          {data.kind === "revoked"
            ? "यह लिंक बंद कर दिया गया है। आपकी लोकेशन शेयर नहीं हो रही है।"
            : "यह लिंक सही नहीं है या पुराना हो गया है।"}
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
      wasSharing={data.status === "active"}
    />
  );
}
