import { getAgentCallStatus } from "./billing-agent";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  agentConnections,
  clientProfiles,
  createDatabase,
  calls,
  stripeEvents,
  billingAccounts,
  billingAuthorizations,
  billingPeriods,
  billingCallUsage,
  billingAuditEvents,
  billingInvoices,
  callAttempts,
  callLegs,
  billingSetupRequests,
  rateCards,
} from "@agentcaller/database";
import { eq, sql } from "drizzle-orm";
import { ensureClientProfileForUser } from "./portal";
import { approveAgentConnection, revokeAgentConnection } from "./oauth-consent";
import { authenticateMcpPrincipal } from "./mcp-auth";
import { getMcpConfig } from "./mcp-config";
import { generateKeyPair, SignJWT } from "jose";
import type Stripe from "stripe";
import { receiveStripeEvent } from "./stripe-events";
import { stripeApiVersion } from "./stripe";
import {
  createBillingSetup,
  resolveBillingSetupToken,
  approveBillingSetup,
  beginBillingCheckout,
  reconcileCheckoutSession,
} from "./billing-setup";
import {
  quoteStripeCall,
  reserveStripeCall,
  finalizeStripeUsage,
} from "./billing-usage";
import { revokeBillingAccess, updateBillingLimits } from "./billing-controls";
import {
  closeBillingPeriod,
  issueMonthlyInvoice,
  reconcileMonthlyInvoice,
  syncInvoiceCollection,
} from "./billing-invoices";
import { drainBilling } from "./billing-drain";
import { blockBillingAccount, drainStripeEvents } from "./billing-events";
import { withdrawCollectionConsent } from "./billing-controls";
import { claimConnectAttempt, connectCommand } from "./connect-me";
import type { AgentPrincipal } from "@agentcaller/contracts";

const url = process.env.BILLING_TEST_DATABASE_URL;
const run = url ? describe : describe.skip;
run("agent onboarding with disposable PostgreSQL", () => {
  if (url && !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Use disposable local PostgreSQL only");
  const first = createDatabase(url ?? "postgresql://localhost/unused");
  const second = createDatabase(url ?? "postgresql://localhost/unused");
  const issuer = "https://issuer.example/auth/v1";
  const config = getMcpConfig({
    NEXT_PUBLIC_APP_URL: "https://agentcaller.example",
    SUPABASE_URL: "https://issuer.example",
    SUPABASE_PUBLISHABLE_KEY: "test",
  });
  const details = (userId: string, clientId = randomUUID()) => ({
    authorization_id: randomUUID(),
    redirect_uri: "https://host.example/callback",
    client: { id: clientId, name: "Offline integration" },
    user: { id: userId },
    scope: "openid",
  });
  beforeAll(async () => {
    await first.client.unsafe(
      "create extension if not exists pgcrypto; create schema if not exists auth; create or replace function auth.uid() returns uuid language sql as $$select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid$$;",
    );
    await first.client.unsafe(
      "create or replace function auth.jwt() returns jsonb language sql as $$select nullif(current_setting('request.jwt.claims', true), '')::jsonb$$;",
    );
    const root = new URL("../../../../supabase/migrations/", import.meta.url);
    let legacyCallId: string | undefined;
    for (const migration of readdirSync(root)
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      if (!legacyCallId && migration.startsWith("20261018")) {
        const [legacy] = await first.db
          .insert(clientProfiles)
          .values({ name: "Historical API-only client" })
          .returning();
        const [call] = await first.client<{ id: string }[]>`insert into calls
          (client_id, idempotency_key, destination, destination_country, language, task, max_duration_seconds, max_amount_micros, rate_card_version)
          values (${legacy!.id}, 'historical-x402-call', '+34911234567', 'ES', 'es', '{"type":"information","questions":["Opening hours?"]}', 60, 10000, 'historical-test-v1') returning id`;
        legacyCallId = call!.id;
      }
      await first.client.unsafe(readFileSync(new URL(migration, root), "utf8"));
    }
    expect(
      (
        await first.db.select().from(calls).where(eq(calls.id, legacyCallId!))
      )[0],
    ).toMatchObject({ fundingSource: "x402", paymentState: "authorized" });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await Promise.all([first.client.end(), second.client.end()]);
  });
  beforeEach(async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_offline");
    vi.stubEnv("STRIPE_PRICING_VERSION", "offline-v1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agentcaller.example");
    vi.stubEnv(
      "BILLING_SETUP_TOKEN_SECRET",
      "offline-independent-billing-token-secret-123456789",
    );
    vi.stubEnv("STRIPE_BILLING_ENABLED", "false");
    await first.db.execute(
      sql`truncate client_profiles, stripe_events, rate_cards cascade`,
    );
  });

  it("creates exactly one non-operator profile for concurrent first logins", async () => {
    const uid = randomUUID();
    const [a, b] = await Promise.all([
      ensureClientProfileForUser(uid, first.db),
      ensureClientProfileForUser(uid, second.db),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.isOperator).toBe(false);
    expect(a.webhookSecret).toBeTruthy();
    expect(await first.db.select().from(clientProfiles)).toHaveLength(1);
  });
  it("does not claim legacy accounts or revive disabled users", async () => {
    await first.db.insert(clientProfiles).values({
      name: "Existing API-only account",
      githubUserId: "display-name",
    });
    const uid = randomUUID();
    const profile = await ensureClientProfileForUser(uid, first.db);
    expect(await first.db.select().from(clientProfiles)).toHaveLength(2);
    await first.db
      .update(clientProfiles)
      .set({ enabled: false })
      .where(eq(clientProfiles.id, profile.id));
    await expect(
      ensureClientProfileForUser(uid, second.db),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await first.db
          .select()
          .from(clientProfiles)
          .where(eq(clientProfiles.id, profile.id))
      )[0]?.enabled,
    ).toBe(false);
  });
  it("deduplicates connection consent across independent transactions", async () => {
    const uid = randomUUID();
    const profile = await ensureClientProfileForUser(uid, first.db);
    const request = details(uid);
    const [a, b] = await Promise.all([
      approveAgentConnection(profile.id, uid, issuer, request, first.db),
      approveAgentConnection(profile.id, uid, issuer, request, second.db),
    ]);
    expect(a.id).toBe(b.id);
    expect(await first.db.select().from(agentConnections)).toHaveLength(1);
    expect(a).toMatchObject({
      status: "active",
      consentedBy: uid,
      consentVersion: "agent-tool-access-v1",
    });
  });
  it("rejects foreign ownership in application code and SQL", async () => {
    const owner = await ensureClientProfileForUser(randomUUID(), first.db);
    const other = await ensureClientProfileForUser(randomUUID(), first.db);
    const request = details(other.supabaseUserId!);
    await expect(
      approveAgentConnection(
        owner.id,
        other.supabaseUserId!,
        issuer,
        request,
        first.db,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      first.db.insert(agentConnections).values({
        clientId: owner.id,
        subject: other.supabaseUserId!,
        issuer,
        oauthClientId: randomUUID(),
        name: "Invalid owner",
      }),
    ).rejects.toThrow();
  });
  it("revokes only the owner's connection and cannot revive it through repeated consent", async () => {
    const uid = randomUUID();
    const owner = await ensureClientProfileForUser(uid, first.db);
    const other = await ensureClientProfileForUser(randomUUID(), first.db);
    const request = details(uid);
    const connection = await approveAgentConnection(
      owner.id,
      uid,
      issuer,
      request,
      first.db,
    );
    const keys = await generateKeyPair("ES256");
    const jwt = await new SignJWT({
      client_id: request.client.id,
      role: "authenticated",
    })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(uid)
      .setIssuer(issuer)
      .setAudience(config.resource)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    const http = new Request(config.resource, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(
      await authenticateMcpPrincipal(
        http,
        config,
        first.db,
        () => keys.publicKey,
      ),
    ).toMatchObject({ clientId: owner.id, connectionId: connection.id });
    expect(
      await revokeAgentConnection(other.id, connection.id, second.db),
    ).toBeNull();
    expect(
      (await revokeAgentConnection(owner.id, connection.id, first.db))?.status,
    ).toBe("revoked");
    await expect(
      authenticateMcpPrincipal(http, config, second.db, () => keys.publicKey),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      approveAgentConnection(owner.id, uid, issuer, request, second.db),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("denies PostgREST reads to an OAuth client and all direct connection reads", async () => {
    const uid = randomUUID();
    const owner = await ensureClientProfileForUser(uid, first.db);
    await approveAgentConnection(owner.id, uid, issuer, details(uid), first.db);
    await receiveStripeEvent(
      {
        id: "evt_rlstest",
        type: "checkout.session.completed",
        api_version: stripeApiVersion,
        livemode: false,
        data: { object: { id: "cs_rlstest" } },
      } as unknown as Stripe.Event,
      first.db,
    );
    expect(await first.db.select().from(stripeEvents)).toHaveLength(1);
    await first.client.unsafe(
      "create role billing_test_reader; grant usage on schema public, auth to billing_test_reader; grant select on client_profiles, agent_connections, stripe_events to billing_test_reader",
    );
    await first.db.transaction(async (tx) => {
      await tx.execute(sql`set local role billing_test_reader`);
      await tx.execute(
        sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, client_id: randomUUID() })}, true)`,
      );
      expect(await tx.select().from(clientProfiles)).toHaveLength(0);
      expect(await tx.select().from(agentConnections)).toHaveLength(0);
      expect(await tx.select().from(stripeEvents)).toHaveLength(0);
      await tx.execute(
        sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid })}, true)`,
      );
      expect(await tx.select().from(clientProfiles)).toHaveLength(1);
    });
  });
  it("deduplicates event routing without storing payment payloads", async () => {
    const event = {
      id: "evt_offline",
      type: "checkout.session.completed",
      api_version: stripeApiVersion,
      livemode: false,
      data: {
        object: {
          id: "cs_offline",
          metadata: { private_field: "do-not-store" },
        },
      },
    } as unknown as Stripe.Event;
    await Promise.all([
      receiveStripeEvent(event, first.db),
      receiveStripeEvent(event, second.db),
    ]);
    const rows = await first.db.select().from(stripeEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId: event.id,
      objectId: "cs_offline",
      status: "pending",
      apiVersion: stripeApiVersion,
    });
    expect(JSON.stringify(rows)).not.toContain("private_field");
    await receiveStripeEvent({ ...event, livemode: true }, first.db);
    expect(await first.db.select().from(stripeEvents)).toHaveLength(2);
  });
  it("enforces billing ownership, credit caps and immutable financial facts", async () => {
    const uid = randomUUID();
    const owner = await ensureClientProfileForUser(uid, first.db);
    const other = await ensureClientProfileForUser(randomUUID(), first.db);
    const connection = await approveAgentConnection(
      owner.id,
      uid,
      issuer,
      details(uid),
      first.db,
    );
    const [account] = await first.db
      .insert(billingAccounts)
      .values({ clientId: owner.id })
      .returning();
    await expect(
      first.db
        .insert(billingAccounts)
        .values({ clientId: other.id, creditLimitCents: 1001 }),
    ).rejects.toThrow();
    await expect(
      first.db.insert(billingAuthorizations).values({
        clientId: other.id,
        connectionId: connection.id,
        billingAccountId: account!.id,
      }),
    ).rejects.toThrow();
    const [grant] = await first.db
      .insert(billingAuthorizations)
      .values({
        clientId: owner.id,
        connectionId: connection.id,
        billingAccountId: account!.id,
      })
      .returning();
    const [period] = await first.db
      .insert(billingPeriods)
      .values({
        clientId: owner.id,
        billingAccountId: account!.id,
        startsAt: new Date("2026-10-01Z"),
        endsAt: new Date("2026-11-01Z"),
        limitCents: 1000,
      })
      .returning();
    const rate = {
      currency: "USD" as const,
      pricingVersion: "test-v1",
      connectionFeeMicros: 1000,
      startedMinuteFeeMicros: 1000,
    };
    const [usage] = await first.db
      .insert(billingCallUsage)
      .values({
        clientId: owner.id,
        billingAccountId: account!.id,
        authorizationId: grant!.id,
        connectionId: connection.id,
        periodId: period!.id,
        callReference: randomUUID(),
        credentialId: connection.oauthClientId,
        connectionVersion: 1,
        authorizationVersion: 1,
        requestFingerprint: "synthetic",
        pricingVersion: "test-v1",
        businessRate: rate,
        callbackRate: rate,
        reservedCents: 10,
        state: "finalized",
        finalCents: 1,
        finalizedAt: new Date(),
      })
      .returning();
    await expect(
      first.db
        .update(billingCallUsage)
        .set({ finalCents: 2 })
        .where(eq(billingCallUsage.id, usage!.id)),
    ).rejects.toThrow();
    const [audit] = await first.db
      .insert(billingAuditEvents)
      .values({
        billingAccountId: account!.id,
        clientId: owner.id,
        operationKey: randomUUID(),
        actorType: "system",
        actorId: "offline-test",
        kind: "test",
        detail: {},
      })
      .returning();
    await expect(
      first.db
        .delete(billingAuditEvents)
        .where(eq(billingAuditEvents.id, audit!.id)),
    ).rejects.toThrow();
  });
  const now = new Date("2026-10-18T12:00:00Z");
  async function enrollment() {
    const uid = randomUUID(),
      owner = await ensureClientProfileForUser(uid, first.db);
    const connection = await approveAgentConnection(
      owner.id,
      uid,
      issuer,
      details(uid),
      first.db,
    );
    const principal: AgentPrincipal = {
      clientId: owner.id,
      connectionId: connection.id,
      credentialId: connection.oauthClientId,
      credentialKind: "oauth",
      operations: [...connection.operations] as AgentPrincipal["operations"],
    };
    await first.db.insert(rateCards).values({
      country: "ES",
      version: randomUUID(),
      currency: "USD",
      stripePricingVersion: "offline-v1",
      active: true,
      connectionFeeMicros: 10000,
      startedMinuteFeeMicros: 10000,
    });
    return { uid, owner, connection, principal };
  }
  function fakeStripe(sessionId = "cs_offline", methodId = "pm_offline") {
    let session: Stripe.Checkout.Session;
    const sdk = {
      customers: {
        create: vi.fn(async (params: { metadata: Record<string, string> }) => ({
          id: "cus_offline",
          livemode: false,
          ...params,
        })),
        update: vi.fn(async () => ({})),
      },
      checkout: {
        sessions: {
          create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
            session = {
              ...params,
              id: sessionId,
              livemode: false,
              status: "open",
              url: "https://checkout.stripe.com/offline",
              setup_intent: null,
            } as unknown as Stripe.Checkout.Session;
            return session;
          }),
          retrieve: vi.fn(async () => session),
        },
      },
    };
    return {
      sdk: sdk as unknown as Stripe,
      calls: sdk,
      complete() {
        session = {
          ...session,
          status: "complete",
          setup_intent: {
            id: "seti_offline",
            status: "succeeded",
            usage: "off_session",
            livemode: false,
            customer: "cus_offline",
            metadata: session.metadata,
            payment_method: {
              id: methodId,
              type: "card",
              livemode: false,
              customer: "cus_offline",
              card: {
                brand: "visa",
                last4: "0000",
                exp_month: 12,
                exp_year: 2030,
              },
            },
          },
        } as Stripe.Checkout.Session;
      },
    };
  }
  async function enrolled() {
    const context = await enrollment(),
      stripe = fakeStripe();
    const setup = await createBillingSetup(
      context.principal,
      "setup",
      "enroll",
      first.db,
      now,
    );
    await approveBillingSetup(
      setup.setupRequestId,
      context.uid,
      "offline@example.test",
      { monthlyLimitCents: 1000, perCallLimitCents: 1000 },
      {
        contactName: "Offline caller",
        agreementVersion: "monthly-usage-v1",
        pricingVersion: "offline-v1",
      },
      first.db,
      now,
    );
    await beginBillingCheckout(
      setup.setupRequestId,
      context.uid,
      stripe.sdk,
      first.db,
      now,
    );
    stripe.complete();
    await reconcileCheckoutSession("cs_offline", stripe.sdk, first.db, now);
    return { ...context, stripe, setup };
  }
  const callIntent = () => ({
    destination: "+34911234567",
    destinationCountry: "ES",
    language: "es",
    maxDurationSeconds: 900,
    maxAmountCents: 1000,
    task: {
      type: "connect_me",
      callbackNumber: "+34612345678",
      callbackLanguage: "es",
      purpose: "Opening hours",
      maxAttempts: 1,
      callingWindow: "now",
      expiresAt: "2026-10-18T12:25:00Z",
    },
  });
  it("deduplicates setup links without granting authority on GET", async () => {
    const { principal, uid } = await enrollment();
    const [a, b] = await Promise.all([
      createBillingSetup(principal, "setup", "enroll", first.db, now),
      createBillingSetup(principal, "setup", "enroll", second.db, now),
    ]);
    expect(a).toEqual(b);
    const token = new URL(a.setupUrl).searchParams.get("request")!;
    await expect(
      resolveBillingSetupToken(token, randomUUID(), first.db, now),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await resolveBillingSetupToken(token, uid, first.db, now)).status,
    ).toBe("pending");
    expect(
      (await first.db.select().from(billingAccounts))[0]?.collectionConsent,
    ).toBe(false);
    expect(
      (await first.db.select().from(billingAuthorizations))[0]?.status,
    ).toBe("pending");
  });
  it("requires human ownership and verified Stripe completion before activating a grant", async () => {
    const { principal, uid } = await enrollment(),
      stripe = fakeStripe();
    const setup = await createBillingSetup(
      principal,
      "setup",
      "enroll",
      first.db,
      now,
    );
    const limits = { monthlyLimitCents: 1000, perCallLimitCents: 1000 },
      versions = {
        contactName: "Offline caller",
        agreementVersion: "monthly-usage-v1",
        pricingVersion: "offline-v1",
      };
    await expect(
      approveBillingSetup(
        setup.setupRequestId,
        randomUUID(),
        "offline@example.test",
        limits,
        versions,
        first.db,
        now,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await approveBillingSetup(
      setup.setupRequestId,
      uid,
      "offline@example.test",
      limits,
      versions,
      first.db,
      now,
    );
    expect(
      (await first.db.select().from(billingAuthorizations))[0]?.status,
    ).toBe("pending");
    await beginBillingCheckout(
      setup.setupRequestId,
      uid,
      stripe.sdk,
      first.db,
      now,
    );
    await reconcileCheckoutSession("cs_offline", stripe.sdk, first.db, now);
    expect(
      (await first.db.select().from(billingSetupRequests))[0]?.status,
    ).toBe("processing");
    stripe.complete();
    await Promise.all([
      reconcileCheckoutSession("cs_offline", stripe.sdk, first.db, now),
      reconcileCheckoutSession("cs_offline", stripe.sdk, second.db, now),
    ]);
    expect(
      (await first.db.select().from(billingAuthorizations))[0]?.status,
    ).toBe("active");
    expect((await first.db.select().from(billingAccounts))[0]).toMatchObject({
      status: "active",
      paymentMethodId: "pm_offline",
      cardLast4: "0000",
    });
    expect(await first.db.select().from(calls)).toHaveLength(0);
  });
  it("keeps paid admission disabled and commits one reservation for concurrent retries", async () => {
    const { principal } = await enrolled();
    const quote = await quoteStripeCall(principal, callIntent(), first.db, now),
      input = { ...callIntent(), quoteVersion: quote.quoteVersion };
    await expect(
      reserveStripeCall(principal, "call", input, first.db, now),
    ).rejects.toMatchObject({ status: 503 });
    expect(await first.db.select().from(calls)).toHaveLength(0);
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    const [a, b] = await Promise.all([
      reserveStripeCall(principal, "call", input, first.db, now),
      reserveStripeCall(principal, "call", input, second.db, now),
    ]);
    expect(a.id).toBe(b.id);
    expect(await first.db.select().from(billingCallUsage)).toHaveLength(1);
    expect(
      (await first.db.select().from(billingPeriods))[0]?.reservedCents,
    ).toBe(quote.maximumCents);
    await expect(
      reserveStripeCall(
        principal,
        "call",
        { ...input, maxAmountCents: 999 },
        first.db,
        now,
      ),
    ).rejects.toMatchObject({ status: 409 });
    vi.stubEnv("STRIPE_BILLING_ENABLED", "false");
    expect(
      (
        await reserveStripeCall(
          principal,
          "call",
          input,
          first.db,
          new Date("2026-12-01Z"),
        )
      ).id,
    ).toBe(a.id);
    await first.db
      .update(calls)
      .set({ state: "cancelled", endedAt: now })
      .where(eq(calls.id, a.id));
    await Promise.all([
      finalizeStripeUsage(a.id, first.db, now),
      finalizeStripeUsage(a.id, second.db, now),
    ]);
    expect(
      (await first.db.select().from(billingPeriods))[0]?.reservedCents,
    ).toBe(0);
    expect((await first.db.select().from(billingCallUsage))[0]).toMatchObject({
      state: "released",
      finalCents: 0,
    });
  });
  it("serializes competing reservations against the shared monthly allowance", async () => {
    const { principal, owner, uid } = await enrolled();
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    const quote = await quoteStripeCall(principal, callIntent(), first.db, now);
    await updateBillingLimits(
      owner.id,
      uid,
      {
        monthlyLimitCents: quote.maximumCents + 1,
        perCallLimitCents: quote.maximumCents,
      },
      undefined,
      first.db,
      now,
    );
    const input = { ...callIntent(), quoteVersion: quote.quoteVersion };
    const results = await Promise.allSettled([
      reserveStripeCall(principal, "one", input, first.db, now),
      reserveStripeCall(principal, "two", input, second.db, now),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (await first.db.select().from(billingPeriods))[0]?.reservedCents,
    ).toBe(quote.maximumCents);
    await expect(
      updateBillingLimits(
        owner.id,
        uid,
        { monthlyLimitCents: 1, perCallLimitCents: 1 },
        undefined,
        first.db,
        now,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("blocks worker permissions after revocation and retains late accounting observations", async () => {
    const { principal, owner, connection } = await enrolled();
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    const quote = await quoteStripeCall(principal, callIntent(), first.db, now);
    const call = await reserveStripeCall(
      principal,
      "call",
      { ...callIntent(), quoteVersion: quote.quoteVersion },
      first.db,
      now,
    );
    const attempt = await claimConnectAttempt(call.id, first.db, now);
    expect(attempt).toBeTruthy();
    const workerId = randomUUID();
    const command = (
      action: "claim" | "dial" | "connected" | "ended",
      at?: string,
    ) =>
      connectCommand(
        call.id,
        {
          action,
          eventId: randomUUID(),
          attemptId: attempt!.id,
          workerId,
          leg: "business",
          ...(at ? { at, sipCallId: "offline-sip" } : {}),
        },
        first.db,
        new Date(now.getTime() + 60_000),
      );
    expect(await command("claim")).toMatchObject({ allowed: true });
    expect(await command("dial")).toMatchObject({ allowed: true });
    await first.db
      .update(callLegs)
      .set({ createdAt: now })
      .where(eq(callLegs.attemptId, attempt!.id));
    await revokeBillingAccess(owner.id, connection.id, false, second.db, now);
    expect(await command("dial")).toMatchObject({ allowed: false });
    await first.db
      .update(callAttempts)
      .set({ roomsCleanedAt: now })
      .where(eq(callAttempts.id, attempt!.id));
    expect(await finalizeStripeUsage(call.id, first.db, now)).toMatchObject({
      state: "metering_pending",
    });
    const [heldPeriod] = await first.db.select().from(billingPeriods);
    await closeBillingPeriod(heldPeriod!.id, first.db, new Date("2026-11-01Z"));
    expect((await first.db.select().from(billingPeriods))[0]?.status).toBe(
      "closing",
    );
    expect(await first.db.select().from(billingInvoices)).toHaveLength(0);
    expect(await command("connected", now.toISOString())).toMatchObject({
      allowed: true,
    });
    expect(
      await command("ended", new Date(now.getTime() + 60_000).toISOString()),
    ).toMatchObject({ allowed: true });
    await Promise.all([
      finalizeStripeUsage(call.id, first.db, now),
      finalizeStripeUsage(call.id, second.db, now),
    ]);
    expect((await first.db.select().from(calls))[0]?.state).toBe("cancelled");
    expect((await first.db.select().from(billingCallUsage))[0]).toMatchObject({
      state: "finalized",
      finalCents: 2,
    });
  });
  it("cannot activate a revoked grant from a delayed successful Checkout", async () => {
    const { principal, uid, owner, connection } = await enrollment(),
      stripe = fakeStripe();
    const setup = await createBillingSetup(
      principal,
      "setup",
      "enroll",
      first.db,
      now,
    );
    await approveBillingSetup(
      setup.setupRequestId,
      uid,
      "offline@example.test",
      { monthlyLimitCents: 1000, perCallLimitCents: 1000 },
      {
        contactName: "Offline caller",
        agreementVersion: "monthly-usage-v1",
        pricingVersion: "offline-v1",
      },
      first.db,
      now,
    );
    await beginBillingCheckout(
      setup.setupRequestId,
      uid,
      stripe.sdk,
      first.db,
      now,
    );
    await revokeBillingAccess(owner.id, connection.id, true, second.db, now);
    stripe.complete();
    await reconcileCheckoutSession("cs_offline", stripe.sdk, first.db, now);
    expect(
      (await first.db.select().from(billingAuthorizations))[0]?.status,
    ).toBe("revoked");
    expect(
      (await first.db.select().from(billingAccounts))[0]?.paymentMethodId,
    ).toBeNull();
  });
  const nextMonth = new Date("2026-11-01T00:01:00Z");
  async function billablePeriod(count = 1) {
    const context = await enrolled();
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    await first.db
      .update(rateCards)
      .set({ connectionFeeMicros: 100000, startedMinuteFeeMicros: 100000 });
    const quote = await quoteStripeCall(
      context.principal,
      callIntent(),
      first.db,
      now,
    );
    for (let index = 0; index < count; index++) {
      const call = await reserveStripeCall(
        context.principal,
        `billable:${index}`,
        { ...callIntent(), quoteVersion: quote.quoteVersion },
        first.db,
        now,
      );
      const [attempt] = await first.db
        .insert(callAttempts)
        .values({
          callId: call.id,
          ordinal: 1,
          businessRoom: `offline-business:${index}`,
          callbackRoom: `offline-callback:${index}`,
          state: "terminal",
          reason: "callback_declined",
          endedAt: new Date(now.getTime() + 360000),
          cleanupUntil: new Date(now.getTime() + 900000),
          roomsCleanedAt: new Date(now.getTime() + 360000),
        })
        .returning();
      await first.db.insert(callLegs).values({
        attemptId: attempt!.id,
        kind: "business",
        identity: `offline-business:${index}`,
        state: "ended",
        connectedAt: now,
        endedAt: new Date(now.getTime() + 360000),
        createdAt: now,
      });
      await first.db
        .update(calls)
        .set({ state: "failed", endedAt: new Date(now.getTime() + 360000) })
        .where(eq(calls.id, call.id));
      await finalizeStripeUsage(call.id, first.db, now);
    }
    const [period] = await first.db.select().from(billingPeriods);
    expect(period!.spentCents).toBe(70 * count);
    await Promise.all([
      closeBillingPeriod(period!.id, first.db, nextMonth),
      closeBillingPeriod(period!.id, second.db, nextMonth),
    ]);
    const [invoice] = await first.db.select().from(billingInvoices);
    expect(invoice!.expectedCents).toBe(70 * count);
    return { ...context, period: period!, invoice: invoice! };
  }
  function fakeInvoices() {
    let invoice: Stripe.Invoice;
    let lines: Stripe.InvoiceLineItem[] = [];
    let item: Stripe.InvoiceItem | undefined;
    const cash: Stripe.InvoicePayment[] = [];
    const calls = {
      invoices: {
        create: vi.fn(async (params: Stripe.InvoiceCreateParams) => {
          invoice ??= {
            ...params,
            id: "in_offline",
            livemode: false,
            status: "draft",
            parent: null,
            total: 0,
            amount_due: 0,
            amount_paid: 0,
            amount_remaining: 0,
            amount_overpaid: 0,
            starting_balance: 0,
            pre_payment_credit_notes_amount: 0,
            post_payment_credit_notes_amount: 0,
            total_discount_amounts: [],
            total_taxes: [],
            attempted: false,
          } as unknown as Stripe.Invoice;
          return invoice;
        }),
        retrieve: vi.fn(async () => invoice),
        listLineItems: vi.fn(async () => ({ data: lines, has_more: false })),
        list: vi.fn(() => (invoice ? [invoice] : [])),
        update: vi.fn(
          async (_id: string, params: Stripe.InvoiceUpdateParams) => {
            Object.assign(invoice, params);
            return invoice;
          },
        ),
        finalizeInvoice: vi.fn(
          async (_id: string, params: Stripe.InvoiceFinalizeInvoiceParams) => {
            Object.assign(invoice, params, { status: "open" });
            return invoice;
          },
        ),
      },
      invoiceItems: {
        create: vi.fn(async (params: Stripe.InvoiceItemCreateParams) => {
          if (!item) {
            item = {
              ...params,
              id: "ii_offline",
            } as unknown as Stripe.InvoiceItem;
            lines = [
              {
                id: "il_offline",
                amount: params.amount,
                metadata: params.metadata,
                parent: {
                  type: "invoice_item_details",
                  invoice_item_details: { invoice_item: item.id },
                },
              },
            ] as Stripe.InvoiceLineItem[];
            Object.assign(invoice, {
              total: params.amount,
              amount_due: params.amount,
              amount_remaining: params.amount,
            });
          }
          return item;
        }),
      },
      invoicePayments: { list: vi.fn(() => cash) },
      refunds: { retrieve: vi.fn(async () => ({ charge: "ch_offline" })) },
      charges: {
        retrieve: vi.fn(async () => ({
          id: "ch_offline",
          customer: "cus_offline",
          livemode: false,
          refunded: true,
        })),
      },
    };
    return {
      sdk: calls as unknown as Stripe,
      calls,
      setStatus(status: "paid" | "open", verified = true) {
        Object.assign(invoice, {
          status,
          attempted: true,
          amount_paid: status === "paid" ? invoice.total : 0,
          amount_remaining: status === "paid" ? 0 : invoice.total,
        });
        cash.length = 0;
        if (status === "paid" && verified)
          cash.push({
            id: "inpay_offline",
            invoice: invoice.id,
            status: "paid",
            livemode: false,
            currency: "usd",
            amount_paid: invoice.total,
            payment: {
              type: "payment_intent",
              payment_intent: {
                id: "pi_offline",
                status: "succeeded",
                customer: "cus_offline",
                livemode: false,
                currency: "usd",
                amount_received: invoice.total,
                latest_charge: {
                  id: "ch_offline",
                  payment_intent: "pi_offline",
                  customer: "cus_offline",
                  paid: true,
                  status: "succeeded",
                  refunded: false,
                  disputed: false,
                  amount_refunded: 0,
                  livemode: false,
                  currency: "usd",
                  payment_method_details: { type: "card" },
                },
              },
            },
          } as Stripe.InvoicePayment);
      },
    };
  }
  it("issues one explicit monthly invoice and reconciles cash once without reviving grants", async () => {
    const { invoice, period, owner, connection } = await billablePeriod(),
      stripe = fakeInvoices();
    await Promise.all([
      issueMonthlyInvoice(invoice.id, stripe.sdk, first.db, nextMonth),
      issueMonthlyInvoice(invoice.id, stripe.sdk, second.db, nextMonth),
    ]);
    expect(stripe.calls.invoices.create).toHaveBeenCalledTimes(1);
    expect(stripe.calls.invoiceItems.create).toHaveBeenCalledTimes(1);
    expect(stripe.calls.invoices.finalizeInvoice).toHaveBeenCalledWith(
      "in_offline",
      { auto_advance: true },
      { idempotencyKey: `monthly:${invoice.id}:finalize:v1` },
    );
    stripe.setStatus("open");
    await reconcileMonthlyInvoice(
      "in_offline",
      stripe.sdk,
      first.db,
      nextMonth,
    );
    expect((await first.db.select().from(billingAccounts))[0]?.status).toBe(
      "past_due",
    );
    await revokeBillingAccess(
      owner.id,
      connection.id,
      false,
      first.db,
      nextMonth,
    );
    stripe.setStatus("paid");
    await Promise.all([
      reconcileMonthlyInvoice("in_offline", stripe.sdk, first.db, nextMonth),
      reconcileMonthlyInvoice("in_offline", stripe.sdk, second.db, nextMonth),
    ]);
    expect(
      (
        await first.db
          .select()
          .from(billingPeriods)
          .where(eq(billingPeriods.id, period.id))
      )[0]?.collectedCents,
    ).toBe(70);
    expect(
      (await first.db.select().from(billingAuthorizations))[0]?.status,
    ).toBe("revoked");
    stripe.setStatus("open");
    await reconcileMonthlyInvoice(
      "in_offline",
      stripe.sdk,
      first.db,
      nextMonth,
    );
    expect(
      (await first.db.select().from(billingInvoices))[0]?.stripeStatus,
    ).toBe("paid");
  });
  it.each(["create", "item", "finalize"] as const)(
    "recovers a lost %s response without a second invoice or charge",
    async (step) => {
      const { invoice } = await billablePeriod(),
        stripe = fakeInvoices();
      if (step === "create") {
        const original = stripe.calls.invoices.create.getMockImplementation()!;
        stripe.calls.invoices.create.mockImplementationOnce(async (params) => {
          await original(params);
          throw new Error("synthetic response loss");
        });
      } else if (step === "item") {
        const original =
          stripe.calls.invoiceItems.create.getMockImplementation()!;
        stripe.calls.invoiceItems.create.mockImplementationOnce(
          async (params) => {
            await original(params);
            throw new Error("synthetic response loss");
          },
        );
      } else {
        const original =
          stripe.calls.invoices.finalizeInvoice.getMockImplementation()!;
        stripe.calls.invoices.finalizeInvoice.mockImplementationOnce(
          async (id, params) => {
            await original(id, params);
            throw new Error("synthetic response loss");
          },
        );
      }
      await issueMonthlyInvoice(invoice.id, stripe.sdk, first.db, nextMonth);
      await issueMonthlyInvoice(invoice.id, stripe.sdk, second.db, nextMonth);
      expect((await first.db.select().from(billingInvoices))[0]).toMatchObject({
        stripeInvoiceId: "in_offline",
        stripeItemId: "ii_offline",
        issuanceState: "ready",
        stripeStatus: "open",
      });
      expect(stripe.calls.invoices.finalizeInvoice).toHaveBeenCalledTimes(1);
    },
  );
  it("holds paid-out-of-band invoices and adjustment events for review", async () => {
    const { invoice } = await billablePeriod(),
      stripe = fakeInvoices();
    await issueMonthlyInvoice(invoice.id, stripe.sdk, first.db, nextMonth);
    stripe.setStatus("paid", false);
    await reconcileMonthlyInvoice(
      "in_offline",
      stripe.sdk,
      first.db,
      nextMonth,
    );
    expect(
      (await first.db.select().from(billingPeriods))[0]?.collectedCents,
    ).toBe(0);
    expect((await first.db.select().from(billingAccounts))[0]).toMatchObject({
      status: "suspended",
      blockReason: "invoice_cash_review",
    });
    await receiveStripeEvent(
      {
        id: "evt_refundtest",
        type: "refund.created",
        livemode: false,
        api_version: stripeApiVersion,
        data: { object: { id: "re_offline" } },
      } as unknown as Stripe.Event,
      first.db,
    );
    const results = await Promise.all([
      drainStripeEvents(stripe.sdk, first.db, nextMonth),
      drainStripeEvents(stripe.sdk, second.db, nextMonth),
    ]);
    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect(
      (await first.db.select().from(billingAccounts))[0]?.blockReason,
    ).toBe("invoice_cash_review");
    expect(
      (
        await first.db
          .select()
          .from(billingAuditEvents)
          .where(eq(billingAuditEvents.kind, "stripe_review_required"))
      )[0]?.detail,
    ).toMatchObject({ reason: "stripe_adjustment_review" });
  });
  it("stops invoice automation after collection consent is withdrawn", async () => {
    const { invoice, owner, uid } = await billablePeriod(),
      stripe = fakeInvoices();
    await issueMonthlyInvoice(invoice.id, stripe.sdk, first.db, nextMonth);
    await withdrawCollectionConsent(owner.id, uid, first.db, nextMonth);
    await syncInvoiceCollection(
      invoice.billingAccountId,
      stripe.sdk,
      first.db,
      nextMonth,
    );
    expect(stripe.calls.invoices.update).toHaveBeenLastCalledWith(
      "in_offline",
      { auto_advance: false, default_payment_method: "pm_offline" },
    );
    expect((await first.db.select().from(billingPeriods))[0]?.spentCents).toBe(
      70,
    );
  });
  it("does not recreate an unmapped invoice after Stripe key retention expires", async () => {
    const { invoice } = await billablePeriod(),
      stripe = fakeInvoices();
    await first.db
      .update(billingInvoices)
      .set({
        createStartedAt: new Date("2026-10-30Z"),
        issuanceState: "creating",
      })
      .where(eq(billingInvoices.id, invoice.id));
    await issueMonthlyInvoice(invoice.id, stripe.sdk, first.db, nextMonth);
    expect(stripe.calls.invoices.create).not.toHaveBeenCalled();
    expect((await first.db.select().from(billingInvoices))[0]).toMatchObject({
      issuanceState: "unknown",
      lastError: "invoice_create_unknown",
    });
  });
  it("recovers an unmapped existing invoice by metadata after key retention", async () => {
    const { invoice } = await billablePeriod(),
      stripe = fakeInvoices();
    const original = stripe.calls.invoices.create.getMockImplementation()!;
    stripe.calls.invoices.create.mockImplementationOnce(async (params) => {
      await original(params);
      throw new Error("synthetic response loss");
    });
    await issueMonthlyInvoice(invoice.id, stripe.sdk, first.db, nextMonth);
    await issueMonthlyInvoice(
      invoice.id,
      stripe.sdk,
      second.db,
      new Date("2026-11-03Z"),
    );
    expect(stripe.calls.invoices.create).toHaveBeenCalledTimes(1);
    expect(
      (await first.db.select().from(billingInvoices))[0]?.issuanceState,
    ).toBe("ready");
  });
  it("closes zero and below-minimum months without a Stripe invoice", async () => {
    const { principal } = await enrolled();
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    const quote = await quoteStripeCall(principal, callIntent(), first.db, now);
    const call = await reserveStripeCall(
      principal,
      "zero",
      { ...callIntent(), quoteVersion: quote.quoteVersion },
      first.db,
      now,
    );
    await first.db
      .update(calls)
      .set({ state: "cancelled", endedAt: now })
      .where(eq(calls.id, call.id));
    await finalizeStripeUsage(call.id, first.db, now);
    const [period] = await first.db.select().from(billingPeriods),
      [usage] = await first.db.select().from(billingCallUsage);
    await closeBillingPeriod(period!.id, first.db, nextMonth);
    expect((await first.db.select().from(billingPeriods))[0]).toMatchObject({
      status: "closed",
      totalCents: 0,
    });
    const [small] = await first.db
      .insert(billingPeriods)
      .values({
        clientId: principal.clientId,
        billingAccountId: period!.billingAccountId,
        startsAt: new Date("2026-11-01Z"),
        endsAt: new Date("2026-12-01Z"),
        limitCents: 1000,
        spentCents: 2,
      })
      .returning();
    await first.db.insert(billingCallUsage).values({
      clientId: principal.clientId,
      billingAccountId: usage!.billingAccountId,
      connectionId: usage!.connectionId,
      authorizationId: usage!.authorizationId,
      periodId: small!.id,
      callReference: randomUUID(),
      credentialId: usage!.credentialId,
      authorizationVersion: usage!.authorizationVersion,
      connectionVersion: usage!.connectionVersion,
      requestFingerprint: "synthetic-small",
      pricingVersion: usage!.pricingVersion,
      businessRate: usage!.businessRate,
      callbackRate: usage!.callbackRate,
      reservedCents: 2,
      finalCents: 2,
      finalizedAt: now,
      state: "finalized",
    });
    await closeBillingPeriod(small!.id, first.db, new Date("2026-12-01Z"));
    expect(
      (
        await first.db
          .select()
          .from(billingPeriods)
          .where(eq(billingPeriods.id, small!.id))
      )[0],
    ).toMatchObject({
      status: "closed",
      totalCents: 0,
      waivedCents: 2,
      spentCents: 2,
    });
    expect(await first.db.select().from(billingInvoices)).toHaveLength(0);
  });
  it("runs the durable billing drain with paid admission disabled", async () => {
    const { invoice } = await billablePeriod(),
      stripe = fakeInvoices();
    vi.stubEnv("STRIPE_BILLING_ENABLED", "false");
    const result = await drainBilling(stripe.sdk, first.db, nextMonth);
    expect(result.deferred).toBe(0);
    expect(result.invoices).toBe(1);
    expect(
      (
        await first.db
          .select()
          .from(billingInvoices)
          .where(eq(billingInvoices.id, invoice.id))
      )[0]?.stripeStatus,
    ).toBe("open");
    expect(process.env.STRIPE_BILLING_ENABLED).toBe("false");
  });
  it("pins the human-approved caller name and rejects an expired quote", async () => {
    const { principal } = await enrolled();
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    const quote = await quoteStripeCall(principal, callIntent(), first.db, now);
    const input = {
      ...callIntent(),
      task: { ...callIntent().task, callerName: "Different caller" },
      quoteVersion: quote.quoteVersion,
    };
    await expect(
      reserveStripeCall(
        principal,
        "expired",
        input,
        first.db,
        new Date("2026-10-18T12:05:00Z"),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const result = await reserveStripeCall(
      principal,
      "name",
      input,
      first.db,
      now,
    );
    expect(
      (await first.db.select().from(calls).where(eq(calls.id, result.id)))[0]
        ?.task,
    ).toMatchObject({ callerName: "Offline caller" });
  });
  it("lets a bounded active call finish across UTC month close without starting another attempt", async () => {
    const { principal } = await enrolled();
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    const start = new Date("2026-10-31T23:55:00Z"),
      afterBoundary = new Date("2026-11-01T00:00:10Z");
    const base = callIntent(),
      raw = {
        ...base,
        task: { ...base.task, expiresAt: "2026-11-01T00:20:00Z" },
      };
    const quote = await quoteStripeCall(principal, raw, first.db, start);
    const call = await reserveStripeCall(
      principal,
      "boundary",
      { ...raw, quoteVersion: quote.quoteVersion },
      first.db,
      start,
    );
    const attempt = await claimConnectAttempt(call.id, first.db, start),
      workerId = randomUUID();
    async function command(
      action: "claim" | "dial" | "connected" | "human" | "heartbeat",
      at = start,
      leg: "business" | "callback" = "business",
    ) {
      return connectCommand(
        call.id,
        {
          action,
          eventId: randomUUID(),
          attemptId: attempt!.id,
          workerId,
          leg,
          ...(action === "connected"
            ? { at: at.toISOString(), sipCallId: "offline-sip" }
            : {}),
        },
        first.db,
        at,
      );
    }
    expect(await command("claim")).toMatchObject({ allowed: true });
    expect(await command("dial")).toMatchObject({ allowed: true });
    expect(await command("connected")).toMatchObject({ allowed: true });
    expect(await command("human")).toMatchObject({ allowed: true });
    await first.db
      .update(callAttempts)
      .set({ heartbeatAt: afterBoundary })
      .where(eq(callAttempts.id, attempt!.id));
    const [period] = await first.db.select().from(billingPeriods);
    await closeBillingPeriod(period!.id, first.db, afterBoundary);
    expect(await command("heartbeat", afterBoundary)).toMatchObject({
      allowed: true,
    });
    expect(await command("dial", afterBoundary, "callback")).toMatchObject({
      allowed: true,
    });
    await claimConnectAttempt(call.id, first.db, afterBoundary);
    expect((await first.db.select().from(calls))[0]?.endedAt).toBeNull();
    expect(await first.db.select().from(callAttempts)).toHaveLength(1);
  });

  it("replaces an unavailable card without changing existing grant authority", async () => {
    const { principal, uid } = await enrolled();
    const [original] = await first.db.select().from(billingAuthorizations),
      [account] = await first.db.select().from(billingAccounts);
    await blockBillingAccount(
      account!.id,
      "saved_card_unavailable",
      "evt_detached",
      first.db,
      now,
    );
    const setup = await createBillingSetup(
        principal,
        "replace",
        "replace_card",
        first.db,
        now,
      ),
      stripe = fakeStripe("cs_replacement", "pm_replacement");
    await approveBillingSetup(
      setup.setupRequestId,
      uid,
      "offline@example.test",
      { monthlyLimitCents: 1000, perCallLimitCents: 1000 },
      {
        agreementVersion: "monthly-usage-v1",
        pricingVersion: "offline-v1",
        contactName: "Offline caller",
      },
      first.db,
      now,
    );
    await beginBillingCheckout(
      setup.setupRequestId,
      uid,
      stripe.sdk,
      first.db,
      now,
    );
    stripe.complete();
    await reconcileCheckoutSession("cs_replacement", stripe.sdk, first.db, now);
    expect((await first.db.select().from(billingAccounts))[0]).toMatchObject({
      status: "active",
      blockReason: null,
      paymentMethodId: "pm_replacement",
    });
    expect(
      (await first.db.select().from(billingAuthorizations))[0]?.version,
    ).toBe(original!.version);
    await blockBillingAccount(
      account!.id,
      "stripe_adjustment_review",
      "evt_refund",
      first.db,
      now,
    );
    await blockBillingAccount(
      account!.id,
      "saved_card_unavailable",
      "evt_latedetached",
      first.db,
      now,
    );
    expect(
      (await first.db.select().from(billingAccounts))[0]?.blockReason,
    ).toBe("stripe_adjustment_review");
    await expect(
      createBillingSetup(
        principal,
        "review-blocked",
        "replace_card",
        first.db,
        now,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("isolates call status between integrations on the same account", async () => {
    const { principal, uid, owner } = await enrolled();
    vi.stubEnv("STRIPE_BILLING_ENABLED", "true");
    const quote = await quoteStripeCall(principal, callIntent(), first.db, now);
    const call = await reserveStripeCall(
      principal,
      "owned",
      { ...callIntent(), quoteVersion: quote.quoteVersion },
      first.db,
      now,
    );
    expect((await getAgentCallStatus(principal, call.id, first.db)).id).toBe(
      call.id,
    );
    const other = await approveAgentConnection(
      owner.id,
      uid,
      issuer,
      details(uid),
      first.db,
    );
    await expect(
      getAgentCallStatus(
        {
          ...principal,
          connectionId: other.id,
          credentialId: other.oauthClientId,
        },
        call.id,
        second.db,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("collects several calls in one monthly invoice", async () => {
    const { invoice, period } = await billablePeriod(2),
      stripe = fakeInvoices();
    expect(await first.db.select().from(billingCallUsage)).toHaveLength(2);
    expect(await first.db.select().from(billingInvoices)).toHaveLength(1);
    await issueMonthlyInvoice(invoice.id, stripe.sdk, first.db, nextMonth);
    expect(stripe.calls.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: "in_offline", amount: 140 }),
      expect.anything(),
    );
    stripe.setStatus("paid");
    await reconcileMonthlyInvoice(
      "in_offline",
      stripe.sdk,
      first.db,
      nextMonth,
    );
    expect(
      (
        await first.db
          .select()
          .from(billingPeriods)
          .where(eq(billingPeriods.id, period.id))
      )[0]?.collectedCents,
    ).toBe(140);
  });
});
