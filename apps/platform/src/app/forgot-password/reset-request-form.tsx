"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "./actions";

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    { error: "", submitted: false },
    "/forgot-password",
  );

  if (state.submitted)
    return (
      <p
        role="status"
        className="rounded-md border border-(--signal) p-4 text-sm leading-relaxed"
      >
        If an account uses that address, a password reset link is on its way.
      </p>
    );

  return (
    <form action={action} className="grid gap-5">
      <label className="grid gap-2 text-sm font-medium">
        Email
        <input
          className="min-h-12 w-full rounded-md border border-(--muted) bg-(--void) px-3 py-3 text-base font-normal text-(--ink) caret-(--signal)"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-(--ember) p-4 text-sm leading-relaxed text-(--ember)"
        >
          {state.error}
        </p>
      )}
      <button
        className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md bg-(--signal) px-4 py-3 text-base font-semibold text-(--void) hover:bg-(--ink) disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
