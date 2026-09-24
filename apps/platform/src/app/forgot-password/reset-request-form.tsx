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
      <p role="status">
        If an account uses that address, a password reset link is on its way.
      </p>
    );

  return (
    <form action={action} className="phone-form">
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      {state.error && (
        <p role="alert" className="phone-error">
          {state.error}
        </p>
      )}
      <button className="phone-primary" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
