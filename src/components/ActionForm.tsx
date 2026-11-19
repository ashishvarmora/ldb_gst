"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { useModalClose } from "@/components/Modal";
import { buttonClass, cx, type ButtonVariant } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

export type FormAction = (
  prev: ActionResult | null,
  formData: FormData,
) => Promise<ActionResult>;

/** Whether the surrounding ActionForm is submitting - see the onSubmit below. */
const ActionPendingContext = createContext(false);

/** True while the surrounding ActionForm (or a React-run form action) is submitting. */
export function useActionPending() {
  const { pending } = useFormStatus();
  const actionPending = useContext(ActionPendingContext);
  return pending || actionPending;
}

/**
 * Wraps a Server Action with inline error/success feedback. On success it
 * closes the surrounding modal (if any) and refreshes the route so the new
 * data is on screen without a manual reload.
 */
export function ActionForm({
  action,
  children,
  className,
  closeOnSuccess = true,
  resetOnSuccess = false,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  closeOnSuccess?: boolean;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    action,
    null,
  );
  const closeModal = useModalClose();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) formRef.current?.reset();
    if (closeOnSuccess) closeModal();
    router.refresh();
  }, [state, closeOnSuccess, resetOnSuccess, closeModal, router]);

  /*
   * KEEP WHAT WAS TYPED (16 Nov 2026). React 19 resets every uncontrolled
   * field once a form action finishes - including when it finishes with an
   * error - so "That truck number looks too short" arrived with the number
   * gone, and a sign-up refused for a mismatched password cleared the name,
   * email and phone. Submitting through onSubmit instead of letting React run
   * the action keeps the fields; a form that should clear on success still
   * says so with resetOnSuccess.
   *
   * `action` stays on the element for the moment before the page hydrates, so
   * an early tap still posts to the Server Action instead of becoming a GET
   * with the fields in the URL.
   */
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className={className}>
      <ActionPendingContext.Provider value={isPending}>{children}</ActionPendingContext.Provider>

      {state && !state.ok ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </p>
      ) : null}

      {state?.ok && state.message ? (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-good-500/40 bg-good-500/10 px-3 py-2 text-sm text-good-500">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  pendingLabel,
  ariaLabel,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  className?: string;
  pendingLabel?: string;
  /** For a button whose visible text is hidden on small screens. */
  ariaLabel?: string;
}) {
  const { pending: formPending } = useFormStatus();
  // useFormStatus only sees React-run actions; ActionForm submits itself.
  const actionPending = useContext(ActionPendingContext);
  const pending = formPending || actionPending;
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={ariaLabel}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : null}
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}

/** Submit button that asks for confirmation first. For destructive actions. */
export function ConfirmSubmitButton({
  children,
  message,
  variant = "danger",
  size = "sm",
  className,
}: {
  children: ReactNode;
  message: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  className?: string;
}) {
  const { pending: formPending } = useFormStatus();
  // useFormStatus only sees React-run actions; ActionForm submits itself.
  const actionPending = useContext(ActionPendingContext);
  const pending = formPending || actionPending;
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

/** A form with no visible fields - one button that fires a Server Action. */
export function InlineActionForm({
  action,
  hidden,
  children,
  className,
}: {
  action: FormAction;
  hidden?: Record<string, string>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(action, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className={cx("inline-flex flex-col items-end gap-1", className)}>
      {hidden
        ? Object.entries(hidden).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))
        : null}
      {children}
      {state && !state.ok ? <span className="text-xs text-bad-500">{state.error}</span> : null}
    </form>
  );
}
