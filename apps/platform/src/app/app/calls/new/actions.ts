"use server";
import { z, ZodError } from "zod";
import { CALL_NOW_TTL_MS } from "@agentcaller/contracts";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/auth";
import { requireClientProfile } from "@/lib/portal";
import { portalCallInput } from "@/lib/portal-call-input";
import { portalCallError, type CallFormState } from "@/lib/portal-call-errors";
import { submitCall } from "@/lib/submit-call";

export async function getCallNowDeadline(): Promise<string> {
  return new Date(Date.now() + CALL_NOW_TTL_MS).toISOString();
}

export async function startCall(
  _previous: CallFormState,
  form: FormData,
): Promise<CallFormState> {
  let id: string;
  try {
    const profile = await requireClientProfile();
    if (!profile.enabled || !profile.isOperator)
      return {
        error: "An enabled operator account is required.",
        fieldErrors: {},
      };
    let input: ReturnType<typeof portalCallInput>;
    let identifiers: { idempotencyKey: string; redialOf?: string };
    try {
      identifiers = z
        .object({
          idempotencyKey: z.string().uuid(),
          redialOf: z.string().uuid().optional(),
        })
        .parse({
          idempotencyKey: form.get("idempotencyKey"),
          redialOf: form.get("redialOf") || undefined,
        });
      input = portalCallInput(form);
    } catch (error) {
      if (error instanceof ZodError) return portalCallError(error);
      throw error;
    }
    const { idempotencyKey: key, redialOf } = identifiers;
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
          typeof result.error === "string" && result.error
            ? result.error
            : "Call could not be accepted. Try again with the same form.",
        fieldErrors: {},
      };
    id = result.data.id;
  } catch (error) {
    if (error instanceof ApiError)
      return { error: error.message, fieldErrors: {} };
    return {
      error:
        "Could not confirm submission. Check Recents, then retry this same form to avoid a duplicate call.",
      fieldErrors: {},
    };
  }
  revalidatePath("/app");
  redirect(`/app/calls/${id}`);
}
