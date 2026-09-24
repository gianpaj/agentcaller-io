import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import { signInWithGithub } from "./actions";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");
  const { error } = await searchParams;
  return (
    <main className="phone-app phone-login">
      <section className="phone-panel">
        <p className="phone-eyebrow">AgentCaller</p>
        <h1>Your calling assistant</h1>
        <p className="phone-muted">Sign in with your operator account.</p>
        <LoginForm />
        <details>
          <summary>Other sign-in options</summary>
          <form action={signInWithGithub}>
            <button className="phone-secondary">Continue with GitHub</button>
          </form>
        </details>
        {error && (
          <p role="alert">
            GitHub sign-in is unavailable. Use your email and password.
          </p>
        )}
        <p className="phone-muted">
          Accounts are created by the operator. For password recovery, use the
          Supabase dashboard.
        </p>
      </section>
    </main>
  );
}
