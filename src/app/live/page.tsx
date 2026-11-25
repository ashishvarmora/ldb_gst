import { redirect } from "next/navigation";

/* 0082: Trips is the Live home. Drivers (with live status) are under Masters. */
export default function LiveHome() {
  redirect("/live/trips");
}
