"use server";
import { z } from "zod";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireHumanSession } from "@/lib/portal";
import {
  approveBillingSetup,
  beginBillingCheckout,
  resolveBillingSetupToken,
} from "@/lib/billing-setup";

export async function saveBillingConsent(form: FormData) {
  const { user } = await requireHumanSession();
  if (form.get("consent") !== "yes" || !user.email || !user.email_confirmed_at)
    throw new Error(
      "Confirm the monthly collection agreement using a verified email address",
    );
  const request = await resolveBillingSetupToken(
    (await cookies()).get("billing_continuation")?.value ?? "",
    user.id,
  );
  await approveBillingSetup(
    request.id,
    user.id,
    user.email,
    {
      monthlyLimitCents: Number(form.get("monthlyLimitCents")),
      perCallLimitCents: Number(form.get("perCallLimitCents")),
    },
    {
      agreementVersion: z.string().parse(form.get("agreementVersion")),
      pricingVersion: z.string().parse(form.get("pricingVersion")),
    },
  );
  redirect(await beginBillingCheckout(request.id, user.id));
}
