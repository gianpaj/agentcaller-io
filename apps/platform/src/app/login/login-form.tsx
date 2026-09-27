"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(
    signIn,
    { error: "" },
    "/login",
  );
  return (
    <form action={action} className="grid gap-5">
      <label className="grid gap-2 text-sm font-medium">
        Email
        <input
          className="min-h-12 w-full rounded-md border border-(--muted) bg-(--void) px-3 py-3 text-base font-normal text-(--ink) caret-(--signal)"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Password
        <input
          className="min-h-12 w-full rounded-md border border-(--muted) bg-(--void) px-3 py-3 text-base font-normal text-(--ink) caret-(--signal)"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
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
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
