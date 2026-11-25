import { redirect } from "next/navigation";

/* 0082: everything is a trip. The old "Track a driver" screen now opens New trip. */
export default async function OldNewPage({ searchParams }: { searchParams: Promise<{ copy?: string }> }) {
  const sp = await searchParams;
  redirect(sp.copy ? `/live/trips/new?copy=${encodeURIComponent(sp.copy)}` : "/live/trips/new");
}
