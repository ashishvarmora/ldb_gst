import { redirect } from "next/navigation";

/* 0082: profile and account are common for the whole app. Live settings are a section there. */
export default function OldLiveProfile() {
  redirect("/portal/profile/live");
}
