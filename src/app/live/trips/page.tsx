import { redirect } from "next/navigation";

/**
 * The old two-sided trips home. Sending and Receiving are separate pages since
 * v7 (see ../TripBoard.tsx); this keeps every old link, bookmark and the
 * Today tiles working by sending them to the right one with their filters.
 *
 * Old params were prefixed per side (o = sending, i = receiving): os, od, of,
 * ot, oq, op and is, id, … - the prefix of the side being opened is dropped.
 * Without side=in, a link that only filtered the receiving side opens it.
 */
export const dynamic = "force-dynamic";

export default async function TripsHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const onlyIn = !Object.keys(raw).some((k) => /^o[sdftqp]$/.test(k)) && Object.keys(raw).some((k) => /^i[sdftqp]$/.test(k));
  const incoming = get("side") === "in" || onlyIn;
  const prefix = incoming ? "i" : "o";
  const p = new URLSearchParams();
  for (const k of ["s", "d", "f", "t", "q", "p"]) {
    const v = get(`${prefix}${k}`);
    if (v) p.set(k, v.slice(0, 60));
  }
  const qs = p.toString();
  redirect(`${incoming ? "/live/receiving" : "/live/sending"}${qs ? `?${qs}` : ""}`);
}
