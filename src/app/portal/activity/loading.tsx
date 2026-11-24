import { HistorySkeleton } from "@/components/HistorySkeleton";

/** Same boxes as the page: see HistorySkeleton. */
export default function Loading() {
  return <HistorySkeleton segmented={false} toolbarRows={2} />;
}