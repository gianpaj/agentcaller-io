import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
    await Promise.all([first.client.end(), second.client.end()]);
  });
  beforeEach(async () => {
    await first.db.execute(
      sql`truncate client_profiles, stripe_events cascade`,
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
      first.db
        .insert(billingAuthorizations)
        .values({
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
});
