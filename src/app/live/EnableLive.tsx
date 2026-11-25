import { BellRing, FileText, MapPinned, Navigation, Route, Share2 } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";

import { enableLiveModuleForm } from "./actions";

/** First visit to /live: what it is, and one button. Free for now. */
export function EnableLive() {
  const points = [
    { icon: Route, title: "Every dispatch as a trip", text: "Vehicle, driver, customer, invoice, e-way bill and LR in one place." },
    { icon: Navigation, title: "Live GPS from the driver's phone", text: "Send a link on WhatsApp. No app, no device, no cost." },
    { icon: BellRing, title: "Alerts that matter", text: "Left factory, reached customer, long stoppage, likely late, e-way bill expiring." },
    { icon: Share2, title: "Customer tracking link", text: "Your dealer sees where the truck is - nothing else." },
    { icon: FileText, title: "Paste an e-way bill", text: "The form fills itself from the e-way bill or invoice text." },
    { icon: MapPinned, title: "Factories and customers", text: "Save locations once; arrival and departure are marked automatically." },
  ];
  return (
    <div className="mx-auto max-w-2xl">
      <div className="live-hero">
        <span className="live-hero-icon">
          <Navigation size={26} />
        </span>
        <h1>Live tracking</h1>
        <p>For factories and dispatch teams: know where every truck is, today.</p>
      </div>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {points.map(({ icon: Icon, title, text }) => (
          <li key={title} className="panel flex gap-3 p-4">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#fff1e6] text-[#c2570c]">
              <Icon size={19} />
            </span>
            <span className="min-w-0">
              <strong className="block text-[15px] text-strong">{title}</strong>
              <span className="text-sm text-muted">{text}</span>
            </span>
          </li>
        ))}
      </ul>
      <ActionForm action={enableLiveModuleForm} className="mt-6 flex flex-col items-center gap-2" closeOnSuccess={false}>
        <SubmitButton className="w-full sm:w-auto" pendingLabel="Switching on…">
          Switch on Live tracking - free
        </SubmitButton>
        <p className="text-center text-xs text-muted">Your Toll tracking stays exactly as it is. Switch apps any time from the top bar.</p>
      </ActionForm>
    </div>
  );
}
