import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export default async function ResetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=recovery_session");

  return (
    <main className="phone-app phone-login">
      <section className="phone-panel">
        <p className="phone-eyebrow">AgentCaller</p>
        <h1>Choose a new password</h1>
        <p className="phone-muted">
          Updating your password signs out every existing session.
        </p>
        <PasswordForm />
      </section>
    </main>
  );
}
