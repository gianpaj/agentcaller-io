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
    <main className="relative z-1 grid min-h-svh place-items-center bg-(--void) px-5 py-10 font-sans text-(--ink) antialiased selection:bg-(--signal) selection:text-(--void) sm:py-12 [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-4 [&_:focus-visible]:outline-(--signal)">
      <section
        className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-(--line) bg-(--panel) p-6 sm:p-8"
        aria-labelledby="reset-password-title"
      >
        <p className="text-sm font-semibold text-(--signal)">AgentCaller</p>
        <header className="space-y-2">
          <h1
            id="reset-password-title"
            className="text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-3xl"
          >
            Choose a new password
          </h1>
          <p className="text-base leading-relaxed text-(--muted)">
            Updating your password signs out every existing session.
          </p>
        </header>
        <PasswordForm />
      </section>
    </main>
  );
}
