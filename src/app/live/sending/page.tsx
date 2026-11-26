import { TripBoard } from "../TripBoard";

export const metadata = { title: "Live tracking - Sending" };
export const dynamic = "force-dynamic";

export default async function SendingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <TripBoard dir="outgoing" searchParams={await searchParams} />;
}
