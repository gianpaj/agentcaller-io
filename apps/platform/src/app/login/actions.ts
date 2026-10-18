"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthCallbackUrl, getSafeAuthRedirect } from "@/lib/auth-redirect";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function signIn(_previous: { error: string }, form: FormData) {
  const email = field(form, "email").trim();
  const password = field(form, "password");
  if (!email || email.length > 254 || !password || password.length > 1024)
    return { error: "Enter your email and password." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error)
    return {
      error: "Unable to sign in. Check your credentials and try again.",
    };
  redirect(getSafeAuthRedirect(field(form, "next")));
}
export async function signInWithGithub(form: FormData) {
  const supabase = await createSupabaseServerClient();
  const callback = new URL(getAuthCallbackUrl());
  const next = getSafeAuthRedirect(field(form, "next"));
  callback.searchParams.set("next", next);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: callback.toString() },
  });
  const failure = new URLSearchParams({ error: "oauth", next });
  redirect(error || !data.url ? `/login?${failure}` : data.url);
}
export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
