"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPasswordRecoveryCallbackUrl } from "@/lib/auth-redirect";

export type ForgotPasswordState = {
  error: string;
  submitted: boolean;
};

export async function requestPasswordReset(
  _previous: ForgotPasswordState,
  form: FormData,
): Promise<ForgotPasswordState> {
  const email = String(form.get("email") ?? "").trim();
  if (!email || email.length > 254)
    return { error: "Enter a valid email address.", submitted: false };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: getPasswordRecoveryCallbackUrl(),
  });

  if (error)
    return {
      error: "Unable to send a reset email. Wait a moment and try again.",
      submitted: false,
    };

  return { error: "", submitted: true };
}
