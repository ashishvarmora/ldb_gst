import { redirect } from "next/navigation";

/* 0081: Fleet split into Masters > Trucks and Masters > Drivers. */
export default function FleetRedirect() {
  redirect("/live/masters/trucks");
}
