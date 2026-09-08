"use client";

import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";

import { buttonClass, type ButtonVariant } from "@/components/ui";
import { signOutAction } from "@/lib/session-actions";

/**
 * A real form around a real submit button, so signing out is a page navigation
 * rather than something JavaScript has to be present to do.
 *
 * The work happens in signOutAction() on the server - the comment there explains
 * why it had to leave the browser. What matters on this side is that the markup
 * is a `<form action={...}>`: Next.js writes the action's id into the HTML, so a
 * tap submits the form and gets a 303 to /login even if the route's JavaScript
 * has not arrived yet. That was the last way this button could look broken. It
 * renders in the sidebar, the account sheet, the admin header and the no-access
 * page, and on a slow phone three of those four are on screen and tappable well
 * before hydration.
 *
 * There is no failure state left to render. The old button had one - "Sign out
 * failed - retry" - because a client-side revoke could come back with an error
 * and leave the session in place. The server path deletes the cookies whatever
 * happens, so the only outcome is /login.
 *
 * `useFormStatus` is only for the label. It needs to be read inside the form,
 * which is why the button is its own component.
 */
function SignOutSubmit({
  variant,
  size,
  label,
  className,
}: {
  variant: ButtonVariant;
  size: "sm" | "md";
  label: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant, size, className)}
    >
      <LogOut size={14} />
      {pending ? "Signing out..." : label}
    </button>
  );
}

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
  return (
    /* `contents` so the form itself lays out as nothing: every caller styles the
       button and expects it to be the child of their own flex or grid, and a
       wrapper with a box of its own would change the height of all four. */
    <form action={signOutAction} className="contents">
      <SignOutSubmit variant={variant} size={size} label={label} className={className} />
    </form>
  );
}
