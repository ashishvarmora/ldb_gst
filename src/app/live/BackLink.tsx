import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="live-back">
      <ChevronLeft size={16} /> {label}
    </Link>
  );
}
