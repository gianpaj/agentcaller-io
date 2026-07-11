import { redirect } from "next/navigation";
import { getAuthCallbackUrl } from "@/lib/auth-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/app");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: getAuthCallbackUrl() },
  });
  if (error || !data.url)
    return (
      <main className="grid-noise flex min-h-screen items-center justify-center p-6">
        <p className="signal-border bg-[#0d1117] p-6 text-sm">
          GitHub sign-in is not configured. Set the Supabase GitHub provider and
          try again.
        </p>
      </main>
    );
  redirect(data.url);
}
