"use client";
import { useActionState } from "react";
import { cancelFromHistory } from "../../actions";
export function CancelButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelFromHistory, {
    error: "",
  });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="callId" value={id} />
      <button
        className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md border border-(--ember) px-4 py-3 text-base font-medium text-(--ember) hover:bg-(--void) disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        disabled={pending}
      >
        {pending ? "Cancelling…" : "Cancel call"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm leading-relaxed text-(--ember)">
          {state.error}
        </p>
      )}
    </form>
  );
}
