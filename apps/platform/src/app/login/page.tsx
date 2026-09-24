import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import { signInWithGithub } from "./actions";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");
  const { error, message } = await searchParams;
  return (
    <main className="phone-app phone-login">
      <section className="phone-panel">
        <p className="phone-eyebrow">AgentCaller</p>
        <h1>Your calling assistant</h1>
        <p className="phone-muted">Sign in with your operator account.</p>
        {message === "password_updated" && (
          <p role="status">Password updated. Sign in with your new password.</p>
        )}
        <LoginForm />
        <p className="phone-muted">
          <Link href="/forgot-password">Forgot your password?</Link>
        </p>
        <details>
          <summary>Other sign-in options</summary>
          <form action={signInWithGithub}>
            <button className="phone-secondary">Continue with GitHub</button>
          </form>
        </details>
        {error && (
          <p role="alert">
            {error === "oauth"
              ? "GitHub sign-in is unavailable. Use your email and password."
              : "The authentication link is invalid or has expired. Request a new password reset link."}
          </p>
        )}
        <p className="phone-muted">Accounts are created by the operator.</p>
      </section>
    </main>
  );
}
