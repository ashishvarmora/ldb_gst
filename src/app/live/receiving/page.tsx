import { TripBoard } from "../TripBoard";

export const metadata = { title: "Live tracking - Receiving" };
export const dynamic = "force-dynamic";

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <TripBoard dir="incoming" searchParams={await searchParams} />;
}
