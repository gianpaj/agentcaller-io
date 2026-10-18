import { randomUUID } from "node:crypto";
import {
  agentConnections,
  billingAccounts,
  billingAuthorizations,
  billingSetupRequests,
  billingInvoices,
  rateCards,
} from "@agentcaller/database";
import {
  billingContactNameSchema,
  billingLimitsSchema,
  billingSetupInputSchema,
  type AgentPrincipal,
  type BillingLimits,
} from "@agentcaller/contracts";
import { and, eq, inArray, lte, gt, or } from "drizzle-orm";
import { z } from "zod";
import type Stripe from "stripe";
import { ApiError } from "./auth";
import { database } from "./database";
import { getBillingSetupTokenSecret } from "./env";
import { enrollmentBlocked, requireEnrollmentPolicy } from "./billing-policy";
import {
  billingSetupToken,
  billingSetupTokenDigest,
  verifyBillingSetupToken,
} from "./billing-tokens";
import {
  billingAudit,
  lockAgentConnection,
  lockBillingAccount,
} from "./billing-store";
import {
  cardSetupParams,
  stripeClient,
  stripeSetupOperationKey,
  verifiedSetupCard,
} from "./stripe";

const pending = ["pending", "consented", "creating_checkout", "processing"];
const retryWindow = 23 * 3600_000;
type Setup = typeof billingSetupRequests.$inferSelect;

function setupLink(row: Setup, origin: string) {
  const token = billingSetupToken(
    row.id,
    row.tokenGeneration,
    row.expiresAt,
    getBillingSetupTokenSecret(),
  );
  return {
    status: row.status,
    setupRequestId: row.id,
    expiresAt: row.expiresAt.toISOString(),
    setupUrl: `${origin}/billing/connect?${new URLSearchParams({ request: token })}`,
  };
}

export async function createBillingSetup(
  principal: AgentPrincipal,
  key: string,
  purpose: "enroll" | "replace_card" = "enroll",
  db = database(),
  now = new Date(),
) {
  billingSetupInputSchema.parse({ idempotencyKey: key });
  const policy = requireEnrollmentPolicy();
  return db.transaction(async (tx) => {
    await tx
      .insert(billingAccounts)
      .values({ clientId: principal.clientId, livemode: policy.livemode })
      .onConflictDoNothing({ target: billingAccounts.clientId });
    const [mapping] = await tx
      .select({ id: billingAccounts.id })
      .from(billingAccounts)
      .where(eq(billingAccounts.clientId, principal.clientId));
    const account = await lockBillingAccount(
      tx,
      mapping!.id,
      principal.clientId,
    );
    const connection = await lockAgentConnection(
      tx,
      principal,
      "billing:setup",
    );
    if (account.livemode !== policy.livemode || enrollmentBlocked(account))
      throw new ApiError(403, "Billing account is unavailable");
    const [previous] = await tx
      .select()
      .from(billingSetupRequests)
      .where(
        and(
          eq(billingSetupRequests.clientId, principal.clientId),
          eq(billingSetupRequests.connectionId, connection.id),
          eq(billingSetupRequests.idempotencyKey, key),
        ),
      );
    if (previous) return setupLink(previous, policy.origin);
    await tx
      .update(billingSetupRequests)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(billingSetupRequests.connectionId, connection.id),
          inArray(billingSetupRequests.status, pending),
          lte(billingSetupRequests.expiresAt, now),
        ),
      );
    const [open] = await tx
      .select()
      .from(billingSetupRequests)
      .where(
        and(
          eq(billingSetupRequests.connectionId, connection.id),
          eq(billingSetupRequests.purpose, purpose),
          inArray(billingSetupRequests.status, pending),
        ),
      );
    if (open) return setupLink(open, policy.origin);
    const recent = await tx
      .select({ id: billingSetupRequests.id })
      .from(billingSetupRequests)
      .where(
        and(
          eq(billingSetupRequests.connectionId, connection.id),
          gt(
            billingSetupRequests.createdAt,
            new Date(now.getTime() - 3600_000),
          ),
        ),
      );
    if (recent.length >= 5)
      throw new ApiError(429, "Too many billing setup requests");
    await tx
      .insert(billingAuthorizations)
      .values({
        billingAccountId: account.id,
        clientId: account.clientId,
        connectionId: connection.id,
      })
      .onConflictDoNothing();
    const [grant] = await tx
      .select()
      .from(billingAuthorizations)
      .where(
        and(
          eq(billingAuthorizations.billingAccountId, account.id),
          eq(billingAuthorizations.connectionId, connection.id),
        ),
      )
      .for("update");
    if (!grant || ["revoked", "expired"].includes(grant.status))
      throw new ApiError(403, "Spending authorization is revoked");
    const id = randomUUID(),
      expiresAt = new Date(now.getTime() + 86400_000);
    const token = billingSetupToken(
      id,
      1,
      expiresAt,
      getBillingSetupTokenSecret(),
    );
    const [row] = await tx
      .insert(billingSetupRequests)
      .values({
        id,
        billingAccountId: account.id,
        clientId: account.clientId,
        connectionId: connection.id,
        authorizationId: grant.id,
        expectedUserId: connection.subject,
        idempotencyKey: key,
        purpose,
        tokenDigest: billingSetupTokenDigest(token),
        expiresAt,
        cardGeneration: account.cardGeneration,
        authorizationVersion: grant.version,
        agreementVersion: policy.agreementVersion,
        pricingVersion: policy.pricingVersion,
      })
      .returning();
    await billingAudit(
      tx,
      account,
      `setup:${id}:requested`,
      "setup_requested",
      "agent",
      principal.credentialId,
      { requestId: id, connectionId: connection.id, purpose },
    );
    return setupLink(row!, policy.origin);
  });
}

export async function resolveBillingSetupToken(
  token: string,
  userId?: string,
  db = database(),
  now = new Date(),
) {
  if (!/^[\w-]{43}$/.test(token))
    throw new ApiError(404, "Setup link is unavailable");
  const [row] = await db
    .select()
    .from(billingSetupRequests)
    .where(
      eq(billingSetupRequests.tokenDigest, billingSetupTokenDigest(token)),
    );
  if (
    !row ||
    !verifyBillingSetupToken(token, row.tokenDigest, row.expiresAt, now) ||
    billingSetupToken(
      row.id,
      row.tokenGeneration,
      row.expiresAt,
      getBillingSetupTokenSecret(),
    ) !== token ||
    row.status === "revoked"
  )
    throw new ApiError(404, "Setup link expired or unavailable");
  if (userId && row.expectedUserId !== userId)
    throw new ApiError(
      403,
      "Sign in with the account that connected this integration",
    );
  return row;
}

export async function billingSetupStatus(
  principal: AgentPrincipal,
  id: string,
  db = database(),
  now = new Date(),
) {
  z.uuid().parse(id);
  await db.transaction((tx) =>
    lockAgentConnection(tx, principal, "billing:read"),
  );
  const [row] = await db
    .select()
    .from(billingSetupRequests)
    .where(
      and(
        eq(billingSetupRequests.id, id),
        eq(billingSetupRequests.clientId, principal.clientId),
        eq(
          billingSetupRequests.connectionId,
          principal.connectionId ?? "00000000-0000-0000-0000-000000000000",
        ),
      ),
    );
  if (!row) throw new ApiError(404, "Setup request not found");
  return {
    setupRequestId: row.id,
    status:
      row.status !== "ready" && row.expiresAt <= now ? "expired" : row.status,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function billingSetupView(row: Setup, db = database()) {
  const [account] = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.id, row.billingAccountId));
  const [connection] = await db
    .select()
    .from(agentConnections)
    .where(
      and(
        eq(agentConnections.id, row.connectionId),
        eq(agentConnections.clientId, row.clientId),
      ),
    );
  const rates = await db
    .select()
    .from(rateCards)
    .where(
      and(
        eq(rateCards.active, true),
        eq(rateCards.currency, "USD"),
        eq(rateCards.stripePricingVersion, row.pricingVersion ?? ""),
      ),
    );
  if (!account || !connection || connection.status !== "active")
    throw new ApiError(403, "Integration is unavailable");
  const [grant] = await db
    .select()
    .from(billingAuthorizations)
    .where(eq(billingAuthorizations.id, row.authorizationId));
  return { account, connection, grant, rates };
}

export async function approveBillingSetup(
  id: string,
  userId: string,
  email: string,
  limits: BillingLimits,
  versions: {
    agreementVersion: string;
    pricingVersion: string;
    contactName: string;
  },
  db = database(),
  now = new Date(),
) {
  billingLimitsSchema.parse(limits);
  const contactName = billingContactNameSchema.parse(versions.contactName);
  z.email().parse(email);
  const policy = requireEnrollmentPolicy();
  const [locator] = await db
    .select()
    .from(billingSetupRequests)
    .where(eq(billingSetupRequests.id, id));
  if (!locator || locator.expectedUserId !== userId)
    throw new ApiError(403, "Setup ownership mismatch");
  return db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      locator.billingAccountId,
      locator.clientId,
    );
    const [connection] = await tx
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.id, locator.connectionId))
      .for("update");
    const [grant] = await tx
      .select()
      .from(billingAuthorizations)
      .where(eq(billingAuthorizations.id, locator.authorizationId))
      .for("update");
    const [request] = await tx
      .select()
      .from(billingSetupRequests)
      .where(eq(billingSetupRequests.id, id))
      .for("update");
    if (
      !request ||
      request.expectedUserId !== userId ||
      request.expiresAt <= now ||
      !connection ||
      connection.subject !== userId ||
      connection.status !== "active" ||
      !grant ||
      ["revoked", "expired"].includes(grant.status) ||
      enrollmentBlocked(account)
    )
      throw new ApiError(403, "Setup consent is unavailable");
    if (
      request.agreementVersion !== versions.agreementVersion ||
      request.pricingVersion !== versions.pricingVersion ||
      versions.agreementVersion !== policy.agreementVersion ||
      versions.pricingVersion !== policy.pricingVersion
    )
      throw new ApiError(
        409,
        "Billing terms changed; start a fresh setup request",
      );
    if (request.status !== "pending") {
      if (
        !["consented", "creating_checkout", "processing", "ready"].includes(
          request.status,
        ) ||
        request.monthlyLimitCents !== limits.monthlyLimitCents ||
        request.perCallLimitCents !== limits.perCallLimitCents
      )
        throw new ApiError(409, "This setup consent cannot be changed");
      return request;
    }
    const rates = await tx
      .select({ id: rateCards.id })
      .from(rateCards)
      .where(
        and(
          eq(rateCards.currency, "USD"),
          eq(rateCards.stripePricingVersion, policy.pricingVersion),
          eq(rateCards.active, true),
        ),
      );
    if (!rates.length)
      throw new ApiError(503, "Approved USD pricing is unavailable");
    if (
      grant.status === "active" &&
      (limits.monthlyLimitCents !== grant.monthlyLimitCents ||
        limits.perCallLimitCents !== grant.perCallLimitCents)
    )
      throw new ApiError(
        409,
        "Change active spending limits in billing settings",
      );
    if (
      account.consentVersion &&
      (limits.monthlyLimitCents > account.monthlyLimitCents ||
        limits.perCallLimitCents > account.perCallLimitCents)
    )
      throw new ApiError(
        409,
        "Integration limits cannot exceed the shared account allowance",
      );
    const cardGeneration = account.cardGeneration + 1,
      grantVersion =
        grant.status === "active" ? grant.version : grant.version + 1;
    await tx
      .update(billingAccounts)
      .set({
        ...(!account.consentVersion ? limits : {}),
        consentVersion: policy.agreementVersion,
        pricingVersion: policy.pricingVersion,
        consentedBy: userId,
        consentedAt: now,
        collectionConsent: true,
        cardGeneration,
        billingEmail: email,
        contactName,
        updatedAt: now,
      })
      .where(eq(billingAccounts.id, account.id));
    await tx
      .update(billingAuthorizations)
      .set({
        ...limits,
        version: grantVersion,
        agreementVersion: policy.agreementVersion,
        pricingVersion: policy.pricingVersion,
        consentedBy: userId,
        consentedAt: now,
        effectiveAt: now,
        updatedAt: now,
      })
      .where(eq(billingAuthorizations.id, grant.id));
    const [approved] = await tx
      .update(billingSetupRequests)
      .set({
        ...limits,
        authorizationVersion: grantVersion,
        cardGeneration,
        consentedAt: now,
        status: "consented",
        updatedAt: now,
      })
      .where(eq(billingSetupRequests.id, id))
      .returning();
    await billingAudit(
      tx,
      account,
      `setup:${id}:consent`,
      "spending_consent",
      "human",
      userId,
      {
        requestId: id,
        authorizationId: grant.id,
        grantVersion,
        agreementVersion: policy.agreementVersion,
        pricingVersion: policy.pricingVersion,
        ...limits,
      },
    );
    return approved!;
  });
}

/** A lease controls setup API retries only. It never schedules payment recovery. */
export async function beginBillingCheckout(
  id: string,
  userId: string,
  stripe: Stripe = stripeClient(),
  db = database(),
  now = new Date(),
) {
  const policy = requireEnrollmentPolicy();
  const lease = randomUUID();
  const [locator] = await db
    .select()
    .from(billingSetupRequests)
    .where(eq(billingSetupRequests.id, id));
  if (!locator || locator.expectedUserId !== userId)
    throw new ApiError(403, "Setup ownership mismatch");
  const operation = await db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      locator.billingAccountId,
      locator.clientId,
    );
    const [connection] = await tx
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.id, locator.connectionId))
      .for("update");
    const [grant] = await tx
      .select()
      .from(billingAuthorizations)
      .where(eq(billingAuthorizations.id, locator.authorizationId))
      .for("update");
    const [row] = await tx
      .select()
      .from(billingSetupRequests)
      .where(eq(billingSetupRequests.id, id))
      .for("update");
    if (
      !row ||
      row.expiresAt <= now ||
      account.livemode !== policy.livemode ||
      !connection ||
      connection.status !== "active" ||
      !grant ||
      ["revoked", "expired"].includes(grant.status) ||
      !row.consentedAt ||
      row.authorizationVersion !== grant.version ||
      row.cardGeneration !== account.cardGeneration ||
      !account.collectionConsent ||
      enrollmentBlocked(account)
    )
      throw new ApiError(403, "Setup authorization is unavailable");
    if (row.status === "ready")
      throw new ApiError(409, "Billing setup is complete");
    if (!["consented", "creating_checkout", "processing"].includes(row.status))
      throw new ApiError(409, "Approve billing before saving a card");
    if (row.leaseUntil && row.leaseUntil > now)
      throw new ApiError(409, "Card setup is processing; retry shortly");
    if (
      (row.operationStartedAt &&
        now.getTime() - row.operationStartedAt.getTime() > retryWindow &&
        !row.stripeSessionId) ||
      (account.customerOperationAt &&
        !account.stripeCustomerId &&
        now.getTime() - account.customerOperationAt.getTime() > retryWindow)
    )
      throw new ApiError(
        409,
        "Setup needs operator reconciliation; a new Stripe object will not be created",
      );
    const checkoutExpiresAt =
      row.checkoutExpiresAt ??
      new Date(Math.floor(now.getTime() / 1000) * 1000 + 31 * 60_000);
    if (checkoutExpiresAt >= row.expiresAt)
      throw new ApiError(
        409,
        "Setup link has too little time remaining; request a new link",
      );
    await tx
      .update(billingAccounts)
      .set({ customerOperationAt: account.customerOperationAt ?? now })
      .where(eq(billingAccounts.id, account.id));
    const [request] = await tx
      .update(billingSetupRequests)
      .set({
        status: "creating_checkout",
        operationStartedAt: row.operationStartedAt ?? now,
        checkoutExpiresAt,
        checkoutOrigin: row.checkoutOrigin ?? policy.origin,
        leaseToken: lease,
        leaseUntil: new Date(now.getTime() + 120_000),
        updatedAt: now,
      })
      .where(eq(billingSetupRequests.id, id))
      .returning();
    return { account, request: request! };
  });
  try {
    let customerId = operation.account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        { metadata: { billing_account_id: operation.account.id } },
        {
          idempotencyKey: `billing-account:${operation.account.id}:customer:v1`,
        },
      );
      if (
        customer.livemode !== policy.livemode ||
        customer.metadata.billing_account_id !== operation.account.id
      )
        throw new Error("Customer binding mismatch");
      customerId = customer.id;
      await db.transaction(async (tx) => {
        const current = await lockBillingAccount(tx, operation.account.id);
        if (
          current.stripeCustomerId &&
          current.stripeCustomerId !== customer.id
        )
          throw new Error("Customer mapping conflict");
        await tx
          .update(billingAccounts)
          .set({ stripeCustomerId: customer.id })
          .where(eq(billingAccounts.id, current.id));
      });
    }
    await stripe.customers.update(customerId, {
      email: operation.account.billingEmail!,
    });
    const reference = {
      accountId: operation.account.id,
      requestId: id,
      connectionId: operation.request.connectionId,
      customerId,
      generation: operation.request.generation,
      cardGeneration: operation.request.cardGeneration,
    };
    const session = operation.request.stripeSessionId
      ? await stripe.checkout.sessions.retrieve(
          operation.request.stripeSessionId,
        )
      : await stripe.checkout.sessions.create(
          cardSetupParams(
            reference,
            operation.request.checkoutOrigin!,
            operation.request.checkoutExpiresAt!,
          ),
          { idempotencyKey: stripeSetupOperationKey(reference) },
        );
    if (
      session.livemode !== policy.livemode ||
      session.mode !== "setup" ||
      session.client_reference_id !== id ||
      (typeof session.customer === "string"
        ? session.customer
        : session.customer?.id) !== customerId
    )
      throw new Error("Checkout binding mismatch");
    await db
      .update(billingSetupRequests)
      .set({
        stripeSessionId: session.id,
        stripeSetupIntentId:
          typeof session.setup_intent === "string"
            ? session.setup_intent
            : session.setup_intent?.id,
        status: session.status === "expired" ? "expired" : "processing",
        leaseUntil: null,
        leaseToken: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(billingSetupRequests.id, id),
          eq(billingSetupRequests.leaseToken, lease),
          eq(billingSetupRequests.status, "creating_checkout"),
        ),
      );
    if (session.status !== "open" || !session.url)
      throw new ApiError(
        409,
        "Checkout is complete or expired; check setup status or request a new link",
      );
    const url = new URL(session.url);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com")
      throw new Error("Unexpected Checkout URL");
    return session.url;
  } catch (error) {
    await db
      .update(billingSetupRequests)
      .set({
        leaseUntil: null,
        leaseToken: null,
        lastError: "checkout_reconciliation_required",
        updatedAt: now,
      })
      .where(
        and(
          eq(billingSetupRequests.id, id),
          eq(billingSetupRequests.leaseToken, lease),
        ),
      );
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "Card setup could not be completed; retry the same request",
    );
  }
}

export async function reconcileCheckoutSession(
  sessionId: string,
  stripe: Stripe = stripeClient(),
  db = database(),
  now = new Date(),
) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["setup_intent.payment_method"],
  });
  const parsedId = z.uuid().safeParse(session.metadata?.setup_request_id);
  if (!parsedId.success) return;
  const [row] = await db
    .select()
    .from(billingSetupRequests)
    .where(eq(billingSetupRequests.id, parsedId.data));
  if (!row) return;
  await db.transaction(async (tx) => {
    const account = await lockBillingAccount(
      tx,
      row.billingAccountId,
      row.clientId,
    );
    const [connection] = await tx
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.id, row.connectionId))
      .for("update");
    const [grant] = await tx
      .select()
      .from(billingAuthorizations)
      .where(eq(billingAuthorizations.id, row.authorizationId))
      .for("update");
    const [request] = await tx
      .select()
      .from(billingSetupRequests)
      .where(eq(billingSetupRequests.id, row.id))
      .for("update");
    if (
      !request ||
      !request.consentedAt ||
      !request.operationStartedAt ||
      request.status === "ready" ||
      !pending.includes(request.status) ||
      request.expiresAt <= now ||
      !connection ||
      connection.status !== "active" ||
      !grant ||
      ["revoked", "expired"].includes(grant.status) ||
      request.authorizationVersion !== grant.version ||
      request.cardGeneration !== account.cardGeneration ||
      !account.collectionConsent ||
      enrollmentBlocked(account)
    )
      return;
    if (request.stripeSessionId && request.stripeSessionId !== session.id)
      return;
    if (session.status === "expired") {
      await tx
        .update(billingSetupRequests)
        .set({ status: "expired", updatedAt: now })
        .where(eq(billingSetupRequests.id, request.id));
      return;
    }
    if (session.status !== "complete") return;
    const card = verifiedSetupCard(session, {
      sessionId: session.id,
      accountId: account.id,
      customerId: account.stripeCustomerId!,
      requestId: request.id,
      connectionId: connection.id,
      generation: request.generation,
      cardGeneration: request.cardGeneration,
      livemode: account.livemode,
    });
    const needsRecovery = [
      "saved_card_unavailable",
      "collection_withdrawn",
    ].includes(account.blockReason ?? "");
    const arrears = await tx
      .select({ id: billingInvoices.id })
      .from(billingInvoices)
      .where(
        and(
          eq(billingInvoices.billingAccountId, account.id),
          or(
            eq(billingInvoices.actionRequired, true),
            eq(billingInvoices.issuanceState, "unknown"),
            inArray(billingInvoices.stripeStatus, ["void", "uncollectible"]),
          ),
        ),
      );
    const recoveredStatus = needsRecovery
      ? arrears.length
        ? "past_due"
        : "active"
      : account.status;
    await tx
      .update(billingAccounts)
      .set({
        paymentMethodId: card.paymentMethodId,
        setupIntentId: card.setupIntentId,
        cardBrand: card.brand,
        cardLast4: card.last4,
        cardExpiryMonth: card.expiryMonth,
        cardExpiryYear: card.expiryYear,
        status: account.status === "pending_setup" ? "active" : recoveredStatus,
        blockReason: needsRecovery
          ? arrears.length
            ? "invoice_payment_required"
            : null
          : account.blockReason,
        updatedAt: now,
      })
      .where(eq(billingAccounts.id, account.id));
    await tx
      .update(billingAuthorizations)
      .set({ status: "active", updatedAt: now })
      .where(eq(billingAuthorizations.id, grant.id));
    await tx
      .update(billingSetupRequests)
      .set({
        status: "ready",
        stripeSessionId: session.id,
        stripeSetupIntentId: card.setupIntentId,
        completedAt: now,
        leaseUntil: null,
        leaseToken: null,
        updatedAt: now,
      })
      .where(eq(billingSetupRequests.id, request.id));
    await billingAudit(
      tx,
      account,
      `setup:${request.id}:${request.generation}:activated`,
      "card_setup_verified",
      "stripe",
      session.id,
      {
        authorizationId: grant.id,
        cardGeneration: request.cardGeneration,
        paymentMethodId: card.paymentMethodId,
      },
    );
  });
  const { syncInvoiceCollection } = await import("./billing-invoices");
  await syncInvoiceCollection(row.billingAccountId, stripe, db, now);
}
