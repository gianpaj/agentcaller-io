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

  if (error) {
    console.error("Password reset request failed", {
      code: error.code,
      status: error.status,
    });
    return {
      error:
        error.status === 429
          ? "Too many reset emails were requested. Wait and try again later."
          : "Unable to send a reset email. Check the Supabase redirect configuration and try again.",
      submitted: false,
    };
  }

  return { error: "", submitted: true };
}
