"use client";
import { useActionState } from "react";
import { cancelFromHistory } from "../../actions";
export function CancelButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelFromHistory, {
    error: "",
  });
  return (
    <form action={action}>
      <input type="hidden" name="callId" value={id} />
      <button className="phone-danger" disabled={pending}>
        {pending ? "Cancelling…" : "Cancel call"}
      </button>
      {state.error && (
        <p role="alert" className="phone-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
