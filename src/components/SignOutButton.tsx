"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { buttonClass, type ButtonVariant } from "@/components/ui";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export function SignOutButton({
  variant = "ghost",
  size = "sm",
  label = "Sign out",
  className,
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={async () => {
        setPending(true);
        await getSupabaseBrowser().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut size={14} />
      {pending ? "Signing out..." : label}
    </button>
  );
}
