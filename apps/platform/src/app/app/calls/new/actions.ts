"use server";
import { z, ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/auth";
import { requireClientProfile } from "@/lib/portal";
import { portalCallInput } from "@/lib/portal-call-input";
import { submitCall } from "@/lib/submit-call";
export async function startCall(_previous: { error: string }, form: FormData) {
  let id: string;
  try {
    const profile = await requireClientProfile();
    if (!profile.enabled || !profile.isOperator)
      return { error: "An enabled operator account is required." };
    const key = z.string().uuid().parse(form.get("idempotencyKey"));
    const redialOf = form.get("redialOf")
      ? z.string().uuid().parse(form.get("redialOf"))
      : undefined;
    const input = portalCallInput(form);
    const response = await submitCall(
      new Request("https://portal.internal/calls", {
        method: "POST",
        headers: {
          "idempotency-key": key,
          "x-agentcaller-funding": "operator",
        },
        body: JSON.stringify(input),
      }),
      profile,
      { redialOf },
    );
    const result = await response.json();
    if (!response.ok)
      return {
        error:
          result.error ??
          "Call could not be accepted. Try again with the same form.",
      };
    id = result.data.id;
  } catch (error) {
    if (error instanceof ZodError)
      return {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      };
    if (error instanceof ApiError) return { error: error.message };
    return {
      error:
        "Could not confirm submission. Check Recents, then retry this same form to avoid a duplicate call.",
    };
  }
  revalidatePath("/app");
  redirect(`/app/calls/${id}`);
}
