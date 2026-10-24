import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import { signInWithGithub } from "./actions";
import { getSafeAuthRedirect } from "@/lib/auth-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error, message, next: requestedNext } = await searchParams;
  const next = getSafeAuthRedirect(requestedNext ?? null);
  if (user) redirect(next);
  return (
    <main className="relative z-1 grid min-h-svh place-items-center bg-(--void) px-5 py-10 font-sans text-(--ink) antialiased selection:bg-(--signal) selection:text-(--void) sm:py-12 [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-4 [&_:focus-visible]:outline-(--signal)">
      <section
        className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-(--line) bg-(--panel) p-6 sm:p-8"
        aria-labelledby="login-title"
      >
        <p className="text-sm font-semibold text-(--signal)">AgentCaller</p>
        <header className="space-y-2">
          <h1
            id="login-title"
            className="text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-3xl"
          >
            Your calling assistant
          </h1>
          <p className="text-base leading-relaxed text-(--muted)">
            Sign in to your AgentCaller account.
          </p>
        </header>
        {message === "password_updated" && (
          <p
            role="status"
            className="rounded-md border border-(--signal) p-4 text-sm leading-relaxed"
          >
            Password updated. Sign in with your new password.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-(--ember) p-4 text-sm leading-relaxed text-(--ember)"
          >
            {error === "oauth"
              ? "GitHub sign-in is unavailable. Use your email and password."
              : "The authentication link is invalid or has expired. Request a new password reset link."}
          </p>
        )}
        <LoginForm next={next} />
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4 hover:text-(--signal)"
        >
          Forgot your password?
        </Link>
        <details className="border-t border-(--line) pt-6">
          <summary className="min-h-11 cursor-pointer py-2.5 text-sm leading-6 hover:text-(--signal)">
            Other sign-in options
          </summary>
          <form action={signInWithGithub} className="mt-3">
            <input type="hidden" name="next" value={next} />
            <button className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md border border-(--muted) px-4 py-3 text-base font-semibold hover:border-(--ink) hover:bg-(--void)">
              Continue with GitHub
            </button>
          </form>
        </details>
        <p className="text-sm leading-relaxed text-(--muted)">
          Connecting an agent for the first time? Continue with GitHub to create
          your account.
        </p>
      </section>
    </main>
  );
}
