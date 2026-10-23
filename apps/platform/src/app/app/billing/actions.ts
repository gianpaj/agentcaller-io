"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { agentConnections, billingAccounts } from "@agentcaller/database";
import { agentOperations } from "@agentcaller/contracts";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/auth";
import { requireHumanSession, findClientProfileForUser } from "@/lib/portal";
import { database } from "@/lib/database";
import {
  linkBillingApiKey,
  revokeBillingAccess,
  updateBillingLimits,
  withdrawCollectionConsent,
} from "@/lib/billing-controls";
import { createBillingSetup } from "@/lib/billing-setup";
import { humanInvoiceUrl, syncInvoiceCollection } from "@/lib/billing-invoices";
import { cleanupConnectRooms } from "@/lib/connect-scheduler";

async function owner() {
  const { user } = await requireHumanSession();
  // Billing acts on an existing profile; it must never provision one.
  const profile = await findClientProfileForUser(user.id);
  if (!profile) throw new ApiError(403, "No billing account for this user");
  return { user, profile };
}
export async function changeBillingLimits(form: FormData) {
  const { user, profile } = await owner();
  const grant = z.string().parse(form.get("authorizationId"));
  await updateBillingLimits(
    profile.id,
    user.id,
    {
      monthlyLimitCents: Number(form.get("monthlyLimitCents")),
      perCallLimitCents: Number(form.get("perCallLimitCents")),
    },
    grant || undefined,
  );
  revalidatePath("/app/billing");
}
export async function stopIntegrationSpending(form: FormData) {
  const { profile } = await owner();
  await revokeBillingAccess(
    profile.id,
    z.uuid().parse(form.get("connectionId")),
    false,
  );
  await cleanupConnectRooms();
  revalidatePath("/app/billing");
}
export async function stopCollection() {
  const { user, profile } = await owner();
  await withdrawCollectionConsent(profile.id, user.id);
  const [account] = await database()
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.clientId, profile.id));
  try {
    if (account) await syncInvoiceCollection(account.id);
  } catch {
    redirect("/app/billing?collection=pending");
  }
  redirect("/app/billing?collection=stopped");
}
export async function replaceCard(form: FormData) {
  const { profile } = await owner();
  const [connection] = await database()
    .select()
    .from(agentConnections)
    .where(
      and(
        eq(agentConnections.id, z.uuid().parse(form.get("connectionId"))),
        eq(agentConnections.clientId, profile.id),
        eq(agentConnections.status, "active"),
      ),
    );
  if (!connection) throw new Error("Choose an active integration");
  const setup = await createBillingSetup(
    {
      clientId: profile.id,
      connectionId: connection.id,
      credentialId: connection.oauthClientId,
      credentialKind: "oauth",
      operations: agentOperations.filter((operation) =>
        connection.operations.includes(operation),
      ),
    },
    `human:${randomUUID()}`,
    "replace_card",
  );
  redirect(setup.setupUrl);
}
export async function linkApiKey(form: FormData) {
  const { profile } = await owner();
  await linkBillingApiKey(
    profile.id,
    z.uuid().parse(form.get("keyId")),
    z.uuid().parse(form.get("connectionId")),
  );
  revalidatePath("/app/billing");
}
export async function openInvoice(form: FormData) {
  const { profile } = await owner();
  redirect(
    await humanInvoiceUrl(profile.id, z.uuid().parse(form.get("invoiceId"))),
  );
}
