import { redirect } from "next/navigation";

/* v5: Live settings moved into the Live app's own profile. */
export default function OldLiveSettings() {
  redirect("/live/profile/settings");
}
