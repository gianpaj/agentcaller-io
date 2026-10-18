"use server";

import { redirect } from "next/navigation";
import { validateNewPassword } from "@/lib/password-recovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ResetPasswordState = { error: string };

export async function updatePassword(
  _previous: ResetPasswordState,
  form: FormData,
): Promise<ResetPasswordState> {
  const rawPassword = form.get("password");
  const rawConfirmation = form.get("confirmation");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const confirmation =
    typeof rawConfirmation === "string" ? rawConfirmation : "";
  const validationError = validateNewPassword(password, confirmation);
  if (validationError) return { error: validationError };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "This reset link is invalid or has expired." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error)
    return {
      error: "Unable to update your password. Request a new reset link.",
    };

  const { error: signOutError } = await supabase.auth.signOut({
    scope: "global",
  });
  if (signOutError)
    return {
      error:
        "Password updated, but existing sessions could not be revoked. Revoke them in Supabase before signing in.",
    };

  redirect("/login?message=password_updated");
}
