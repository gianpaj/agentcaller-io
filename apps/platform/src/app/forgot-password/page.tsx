import Link from "next/link";
import { ResetRequestForm } from "./reset-request-form";

export default function ForgotPasswordPage() {
  return (
    <main className="relative z-1 grid min-h-svh place-items-center bg-(--void) px-5 py-10 font-sans text-(--ink) antialiased selection:bg-(--signal) selection:text-(--void) sm:py-12 [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-4 [&_:focus-visible]:outline-(--signal)">
      <section
        className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-(--line) bg-(--panel) p-6 sm:p-8"
        aria-labelledby="forgot-password-title"
      >
        <p className="text-sm font-semibold text-(--signal)">AgentCaller</p>
        <header className="space-y-2">
          <h1
            id="forgot-password-title"
            className="text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-3xl"
          >
            Reset your password
          </h1>
          <p className="text-base leading-relaxed text-(--muted)">
            Enter your operator email and we’ll send a one-time reset link.
          </p>
        </header>
        <ResetRequestForm />
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4 hover:text-(--signal)"
        >
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
