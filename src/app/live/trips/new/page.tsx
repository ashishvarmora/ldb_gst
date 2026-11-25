import { redirect } from "next/navigation";

/* Driver-first (0081): one create screen at /live/new; trip details are a toggle there. */
export default function NewTripRedirect() {
  redirect("/live/new?trip=1");
}
