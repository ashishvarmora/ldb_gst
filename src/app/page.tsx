import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";

export default async function Home() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.profile.status !== "active") redirect("/no-access?reason=suspended");
  redirect(session.profile.role === "super_admin" ? "/admin" : "/portal");
}
