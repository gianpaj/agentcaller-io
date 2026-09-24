"use client";
import { useActionState } from "react";
import { signIn } from "./actions";
export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  return (
    <form action={action} className="phone-form">
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
        />
      </label>
      {state.error && (
        <p role="alert" className="phone-error">
          {state.error}
        </p>
      )}
      <button className="phone-primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
