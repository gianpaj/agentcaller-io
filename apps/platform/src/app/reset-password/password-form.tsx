"use client";

import { useActionState } from "react";
import { passwordRequirements } from "@/lib/password-recovery";
import { updatePassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(
    updatePassword,
    { error: "" },
    "/reset-password",
  );

  return (
    <form action={action} className="grid gap-5">
      <label className="grid gap-2 text-sm font-medium">
        New password
        <input
          className="min-h-12 w-full rounded-md border border-(--muted) bg-(--void) px-3 py-3 text-base font-normal text-(--ink) caret-(--signal)"
          aria-describedby="password-requirements"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={1024}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Confirm password
        <input
          className="min-h-12 w-full rounded-md border border-(--muted) bg-(--void) px-3 py-3 text-base font-normal text-(--ink) caret-(--signal)"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={1024}
        />
      </label>
      <p
        id="password-requirements"
        className="text-sm leading-relaxed text-(--muted)"
      >
        {passwordRequirements}
      </p>
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
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
