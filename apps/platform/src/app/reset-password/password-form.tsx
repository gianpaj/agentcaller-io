"use client";

import { useActionState } from "react";
import { passwordRequirements } from "@/lib/password-recovery";
import { updatePassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, {
    error: "",
  });

  return (
    <form action={action} className="phone-form">
      <label>
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={1024}
        />
      </label>
      <label>
        Confirm password
        <input
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={1024}
        />
      </label>
      <p className="phone-muted">{passwordRequirements}</p>
      {state.error && (
        <p role="alert" className="phone-error">
          {state.error}
        </p>
      )}
      <button className="phone-primary" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
