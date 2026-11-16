import { Skeleton } from "@/components/Skeleton";

/**
 * Support opens as a chat, so its placeholder is a chat: a name bar, a few
 * bubbles on alternate sides and the message box. The dashboard placeholder it
 * used to borrow made the screen jump from panels to a conversation.
 */
export default function SupportLoading() {
  return (
    <div className="flex min-h-[70vh] flex-col" aria-busy="true">
      <div className="flex items-center gap-3 pb-3">
        <Skeleton className="size-10 rounded-xl" />
        <Skeleton className="size-11 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2 h-2.5 w-28" />
        </div>
      </div>

      <div className="panel flex flex-1 flex-col justify-end gap-3 p-4">
        <Skeleton className="h-10 w-3/5 rounded-2xl" />
        <Skeleton className="h-10 w-2/5 self-end rounded-2xl" />
        <Skeleton className="h-14 w-2/3 rounded-2xl" />
        <div className="mt-2 flex items-center gap-2 border-t border-divider pt-3">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="size-11 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
