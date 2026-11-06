"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Keep old saved links useful after separating profile editing from settings. */
export function LegacyProfileRedirect() {
  const router = useRouter();
  useEffect(() => {
    const redirect = () => { if (window.location.hash === "#profile") router.replace("/portal/profile/edit"); };
    redirect(); window.addEventListener("hashchange",redirect);
    return () => window.removeEventListener("hashchange",redirect);
  },[router]);
  return null;
}
