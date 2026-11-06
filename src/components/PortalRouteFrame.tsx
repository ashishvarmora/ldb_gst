"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function PortalRouteFrame({children}:{children:ReactNode}) {
  const path = usePathname();
  const section = path.split("/")[2] ?? "home";
  const accountPage = ["plan","payments","credits","activity","referrals","settings","support"].includes(section);
  return <div className={`page-enter portal-route ${accountPage ? "account-route" : ""}`} data-screen={section}>
    {accountPage && section !== "support" && <Link href="/portal/profile" className="app-back-link"><ArrowLeft size={17}/>Profile</Link>}{children}
  </div>;
}
