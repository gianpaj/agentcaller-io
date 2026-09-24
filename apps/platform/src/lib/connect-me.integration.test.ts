import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  createDatabase,
  calls,
  clientProfiles,
  connectJobs,
  callAttempts,
  callLegs,
  paymentSettlements,
  rateCards,
} from "@agentcaller/database";
import { eq, sql } from "drizzle-orm";
import { createCallSchema, type ConnectEvent } from "@agentcaller/contracts";
import {
  cancelConnect,
  claimConnectAttempt,
  connectCommand,
} from "./connect-me";
const routeState = vi.hoisted(() => ({ db: null as any, client: null as any }));
vi.mock("./database", () => ({ database: () => routeState.db }));
vi.mock("./auth", async (original) => ({
  ...(await original<typeof import("./auth")>()),
  authenticateApiRequest: async () => routeState.client,
}));
import { POST } from "../app/api/v1/calls/route";
import { authorizeOperatorCall } from "./operator-funding";
import { attemptReserve } from "./connect-policy";

// This suite owns a disposable database, never DATABASE_URL or a Supabase project.
const url = process.env.CONNECT_TEST_DATABASE_URL;
const run = url ? describe : describe.skip;
run("connect ledger with PostgreSQL locks", () => {
  if (url && !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Use a disposable local PostgreSQL database");
  const { db, client } = createDatabase(url ?? "postgresql://localhost/unused");
  const now = new Date("2026-09-18T10:00:00Z");
  const rate = { connectionFeeMicros: 1000, startedMinuteFeeMicros: 1000 };
  const input = createCallSchema.parse({
    destination: "+34911234567",
    destinationCountry: "ES",
    language: "es",
    maxDurationSeconds: 900,
    maxAmountUsd: 10,
    task: {
      type: "connect_me",
      callbackNumber: "+34612345678",
      callbackLanguage: "it",
      purpose: "Post office",
      callingWindow: {
        timezone: "Europe/Madrid",
        weekdays: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "17:00",
      },
      expiresAt: "2026-09-19T10:00:00Z",
    },
  });
  let callId: string;
  let clientId: string;
  beforeAll(async () => {
    await client.unsafe(
      "create extension if not exists pgcrypto; create schema if not exists auth; create or replace function auth.uid() returns uuid language sql as 'select null::uuid'; create or replace function auth.jwt() returns jsonb language sql as 'select null::jsonb';",
    );
    for (const migration of [
      "20260710120000_agentcaller_mvp.sql",
      "20260710130000_agentcaller_hardening.sql",
      "20260918190000_connect_me.sql",
      "20260918200000_operator_payment_state.sql",
      "20260918200100_operator_funding.sql",
      "20260924120000_connect_room_cleanup.sql",
    ])
      await client.unsafe(
        readFileSync(
          new URL(
            `../../../../supabase/migrations/${migration}`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await client.end();
  });
  beforeEach(async () => {
    routeState.db = db;
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    vi.stubEnv("CONNECT_OPERATOR_CALLS_ENABLED", "true");
    vi.stubEnv("CONNECT_OPERATOR_DESTINATIONS", "+34911234567,+34612345678");
    vi.stubEnv("CONNECT_OPERATOR_MAX_USD", "10");
    await db.execute(sql`truncate client_profiles, rate_cards cascade`);
    const [client] = await db
      .insert(clientProfiles)
      .values({ name: "Offline test" })
      .returning();
    clientId = client!.id;
    const [call] = await db
      .insert(calls)
      .values({
        clientId,
        idempotencyKey: randomUUID(),
        ...input,
        maxAmountMicros: 10000000,
        rateCardVersion: "test",
      })
      .returning();
    callId = call!.id;
    await db.insert(connectJobs).values({
      callId,
      businessRate: rate,
      callbackRate: rate,
      nextAttemptAt: now,
    });
    await db.insert(paymentSettlements).values({
      callId,
      clientId,
      authorizedMicros: 10000000,
      status: "authorized",
    });
  });
  async function start() {
    const attempt = (await claimConnectAttempt(callId, db, now))!;
    const workerId = randomUUID();
    const event = (
      action: ConnectEvent["action"],
      rest: Partial<ConnectEvent> = {},
    ): ConnectEvent => ({
      eventId: randomUUID(),
      workerId,
      attemptId: attempt.id,
      action,
      ...rest,
    });
    await connectCommand(callId, event("claim"), db, now);
    return {
      attempt,
      event,
      send: (
        action: ConnectEvent["action"],
        rest: Partial<ConnectEvent> = {},
      ) => connectCommand(callId, event(action, rest), db, now),
    };
  }
  it("concurrent ticks create exactly one attempt and reserve once", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => claimConnectAttempt(callId, db, now)),
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const [job] = await db.select().from(connectJobs);
    expect(job!.attemptCount).toBe(1);
    if (input.task.type !== "connect_me") throw new Error();
    expect(job!.reservedMicros).toBe(attemptReserve(input.task, rate, rate));
  });
  it("duplicate workers and dial events cannot originate another leg", async () => {
    const { attempt, event, send } = await start();
    expect(await send("claim", { workerId: randomUUID() })).toEqual({
      allowed: false,
    });
    const dial = event("dial", { leg: "business" });
    expect(await connectCommand(callId, dial, db, now)).toEqual({
      allowed: true,
    });
    expect(await connectCommand(callId, dial, db, now)).toEqual({
      allowed: true,
    });
    expect(await send("dial", { leg: "business" })).toEqual({ allowed: false });
    expect(
      await db
        .select()
        .from(callLegs)
        .where(eq(callLegs.attemptId, attempt.id)),
    ).toHaveLength(1);
  });
  it.each(["busy", "no_answer"] as const)(
    "schedules %s as a new immutable attempt",
    async (reason) => {
      const { attempt, send } = await start();
      await send("dial", { leg: "business" });
      await send("finish", { reason });
      expect(
        await claimConnectAttempt(callId, db, new Date(now.getTime() + 299000)),
      ).toBeNull();
      const next = await claimConnectAttempt(
        callId,
        db,
        new Date(now.getTime() + 300000),
      );
      expect(next!.id).not.toBe(attempt.id);
      expect(next!.ordinal).toBe(2);
      const [old] = await db
        .select()
        .from(callAttempts)
        .where(eq(callAttempts.id, attempt.id));
      expect(old!.state).toBe("terminal");
      expect(
        await send("connected", { leg: "business", at: now.toISOString() }),
      ).toEqual({ allowed: false });
      expect(await db.select().from(paymentSettlements)).toHaveLength(1);
    },
  );
  it.each([
    "voicemail",
    "refused",
    "ivr_unresolved",
    "uncertain_answer",
    "dial_unknown",
    "routing_denied",
    "callback_declined",
    "callback_timeout",
  ] as const)("stops %s without a retry", async (reason) => {
    const { send } = await start();
    await send("finish", { reason });
    expect(
      await claimConnectAttempt(callId, db, new Date(now.getTime() + 300000)),
    ).toBeNull();
    const [call] = await db.select().from(calls);
    expect(call!.endedAt).not.toBeNull();
  });
  it("records connected usage for both legs and preserves unknown timing", async () => {
    const { send } = await start();
    await send("dial", { leg: "business" });
    await send("connected", { leg: "business", at: now.toISOString() });
    await send("human");
    await send("dial", { leg: "callback" });
    await send("ended", { leg: "callback", at: now.toISOString() });
    await send("ended", {
      leg: "business",
      at: new Date(now.getTime() + 61000).toISOString(),
    });
    const legs = await db.select().from(callLegs);
    expect(legs.find((l) => l.kind === "business")!.measuredMicros).toBe(3000);
    expect(legs.find((l) => l.kind === "callback")!.measuredMicros).toBeNull();
    expect(
      await send("connected", { leg: "business", at: now.toISOString() }),
    ).toEqual({ allowed: false });
  });
  it("business hangup prevents callback acceptance", async () => {
    const { send } = await start();
    await send("dial", { leg: "business" });
    await send("connected", { leg: "business", at: now.toISOString() });
    await send("human");
    await send("dial", { leg: "callback" });
    await send("connected", { leg: "callback", at: now.toISOString() });
    await send("ended", { leg: "business", at: now.toISOString() });
    expect(await send("accept")).toEqual({ allowed: false });
  });
  it("cancellation defeats late acceptance and replayed dial permission", async () => {
    const { send, event } = await start();
    const dial = event("dial", { leg: "business" });
    await connectCommand(callId, dial, db, now);
    await cancelConnect(callId, clientId, db);
    expect(await connectCommand(callId, dial, db, now)).toEqual({
      allowed: false,
    });
    expect(await send("accept")).toEqual({ allowed: false });
    expect(await send("finish", { reason: "connected" })).toEqual({
      allowed: false,
    });
  });
  it("does not reveal or cancel another tenant's job", async () => {
    await expect(cancelConnect(callId, randomUUID(), db)).rejects.toMatchObject(
      { status: 404 },
    );
    expect((await db.select().from(calls))[0]!.endedAt).toBeNull();
  });
  it("keeps a live heartbeat through expiry and records that finish", async () => {
    const { attempt, event } = await start();
    const at = new Date("2026-09-19T10:00:00Z");
    await db
      .update(callAttempts)
      .set({ heartbeatAt: at })
      .where(eq(callAttempts.id, attempt.id));
    expect(
      await connectCommand(
        callId,
        event("finish", { reason: "duration_limit" }),
        db,
        at,
      ),
    ).toMatchObject({ allowed: true });
    expect((await db.select().from(calls))[0]!.outcome).toMatchObject({
      reason: "duration_limit",
    });
  });
  it("expires a heartbeating attempt instead of marking the worker lost", async () => {
    const { attempt } = await start();
    const at = new Date("2026-09-19T10:00:00Z");
    await db
      .update(callAttempts)
      .set({ heartbeatAt: at })
      .where(eq(callAttempts.id, attempt.id));
    expect(await claimConnectAttempt(callId, db, at)).toBeNull();
    expect((await db.select().from(calls))[0]!.outcome).toMatchObject({
      reason: "expired",
    });
  });
  it("closes a heartbeating attempt past cleanup as a duration limit", async () => {
    const { attempt } = await start();
    const at = new Date(now.getTime() + 1_000_000);
    await db
      .update(callAttempts)
      .set({ heartbeatAt: at, cleanupUntil: new Date(at.getTime() - 1000) })
      .where(eq(callAttempts.id, attempt.id));
    expect(await claimConnectAttempt(callId, db, at)).toBeNull();
    expect((await db.select().from(calls))[0]!.outcome).toMatchObject({
      reason: "duration_limit",
    });
  });
  it("requeues a business dial that misses the calling window", async () => {
    const { attempt, event } = await start();
    const at = new Date("2026-09-18T15:01:00Z");
    await db
      .update(calls)
      .set({
        task: { ...input.task, expiresAt: "2026-09-21T12:00:00.000Z" },
      })
      .where(eq(calls.id, callId));
    await db
      .update(callAttempts)
      .set({ heartbeatAt: at })
      .where(eq(callAttempts.id, attempt.id));
    expect(
      await connectCommand(callId, event("dial", { leg: "business" }), db, at),
    ).toEqual({ allowed: false, defer: "outside_window" });
    expect(
      await connectCommand(
        callId,
        event("finish", { reason: "outside_window" }),
        db,
        at,
      ),
    ).toMatchObject({ allowed: true });
    const [call] = await db.select().from(calls);
    expect(call!.endedAt).toBeNull();
    expect(call!.state).toBe("queued");
    expect(call!.outcome).toMatchObject({
      reason: "outside_window",
      nextAttemptAt: "2026-09-21T07:00:00.000Z",
    });
  });
  it("does not retry busy after the business leg connects", async () => {
    const { send } = await start();
    await send("dial", { leg: "business" });
    await send("connected", { leg: "business", at: now.toISOString() });
    await send("finish", { reason: "busy" });
    const [call] = await db.select().from(calls);
    const [job] = await db.select().from(connectJobs);
    expect(call!.endedAt).not.toBeNull();
    expect(job!.attemptCount).toBe(1);
    expect(job!.nextAttemptAt).toEqual(now);
  });
  it("does not retry no-answer after the callback leg exists", async () => {
    const { send } = await start();
    await send("dial", { leg: "business" });
    await send("connected", { leg: "business", at: now.toISOString() });
    await send("human");
    await send("dial", { leg: "callback" });
    await send("finish", { reason: "no_answer" });
    const [call] = await db.select().from(calls);
    const [job] = await db.select().from(connectJobs);
    expect(call!.endedAt).not.toBeNull();
    expect(job!.attemptCount).toBe(1);
    expect(job!.nextAttemptAt).toEqual(now);
  });
  it("worker loss after dial intent stops, retains unknown cost, never redials", async () => {
    const { send } = await start();
    await send("dial", { leg: "business" });
    await claimConnectAttempt(callId, db, new Date(now.getTime() + 91000));
    const [call] = await db.select().from(calls);
    expect(call!.outcome).toMatchObject({ reason: "worker_lost" });
    expect((await db.select().from(callLegs))[0]!.measuredMicros).toBeNull();
    expect(
      await claimConnectAttempt(callId, db, new Date(now.getTime() + 300000)),
    ).toBeNull();
  });
  it("lost dispatch cannot be claimed after lease expiry", async () => {
    const attempt = (await claimConnectAttempt(callId, db, now))!;
    await claimConnectAttempt(callId, db, new Date(now.getTime() + 91000));
    expect(
      await connectCommand(
        callId,
        {
          attemptId: attempt.id,
          workerId: randomUUID(),
          eventId: randomUUID(),
          action: "claim",
        },
        db,
        now,
      ),
    ).toEqual({ allowed: false });
  });
  it("refuses an attempt that exceeds remaining spend", async () => {
    await db
      .update(calls)
      .set({ maxAmountMicros: 1 })
      .where(eq(calls.id, callId));
    expect(await claimConnectAttempt(callId, db, now)).toBeNull();
    expect((await db.select().from(calls))[0]!.outcome).toMatchObject({
      reason: "spend_limit",
    });
  });
  it("expires jobs and enforces six attempts", async () => {
    for (let i = 0; i < 6; i++) {
      const at = new Date(now.getTime() + i * 300000);
      const a = (await claimConnectAttempt(callId, db, at))!;
      const workerId = randomUUID();
      const e = (
        action: ConnectEvent["action"],
        reason?: ConnectEvent["reason"],
      ): ConnectEvent => ({
        action,
        reason,
        attemptId: a.id,
        workerId,
        eventId: randomUUID(),
      });
      await connectCommand(callId, e("claim"), db, at);
      await connectCommand(callId, e("finish", "busy"), db, at);
    }
    expect((await db.select().from(calls))[0]!.outcome).toMatchObject({
      reason: "attempts_exhausted",
    });
    expect(
      await claimConnectAttempt(callId, db, new Date("2026-09-20T10:00:00Z")),
    ).toBeNull();
  });
  it("accepts concurrent operator submissions once without a payment receipt", async () => {
    const [admin] = await db
      .update(clientProfiles)
      .set({ isOperator: true })
      .where(eq(clientProfiles.id, clientId))
      .returning();
    routeState.client = admin;
    await db
      .insert(rateCards)
      .values({ version: randomUUID(), country: "ES", active: true, ...rate });
    const key = randomUUID();
    const submit = () =>
      POST(
        new Request("https://offline.invalid/api/v1/calls", {
          method: "POST",
          headers: {
            "idempotency-key": key,
            "x-agentcaller-funding": "operator",
          },
          body: JSON.stringify(input),
        }),
      );
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((r) => r.status)).toEqual([202, 202]);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(results[0].data.id).toBe(results[1].data.id);
    const accepted = results[0].data;
    expect(accepted).toMatchObject({
      fundingSource: "operator",
      paymentState: "not_required",
      operatorAuthorizedBy: clientId,
    });
    expect(
      await db
        .select()
        .from(paymentSettlements)
        .where(eq(paymentSettlements.callId, accepted.id)),
    ).toHaveLength(0);
    await expect(authorizeOperatorCall(accepted.id)).resolves.toBeUndefined();
    await db
      .update(connectJobs)
      .set({ nextAttemptAt: now })
      .where(eq(connectJobs.callId, accepted.id));
    expect(await claimConnectAttempt(accepted.id, db, now)).not.toBeNull();
    await db
      .update(clientProfiles)
      .set({ isOperator: false })
      .where(eq(clientProfiles.id, clientId));
    await expect(authorizeOperatorCall(accepted.id)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("rejects a cap that cannot fund every attempt", async () => {
    const [admin] = await db
      .update(clientProfiles)
      .set({ isOperator: true })
      .where(eq(clientProfiles.id, clientId))
      .returning();
    routeState.client = admin;
    await db
      .insert(rateCards)
      .values({ version: randomUUID(), country: "ES", active: true, ...rate });
    const response = await POST(
      new Request("https://offline.invalid/api/v1/calls", {
        method: "POST",
        headers: {
          "idempotency-key": randomUUID(),
          "x-agentcaller-funding": "operator",
        },
        body: JSON.stringify({ ...input, maxAmountUsd: 0.01 }),
      }),
    );
    expect(response.status).toBe(422);
    expect(await db.select().from(calls)).toHaveLength(1);
  });
  it("cannot dispatch an x402 job through the operator permission path", async () => {
    await expect(authorizeOperatorCall(callId)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("reconciles worker loss even when new operator dispatch is disabled", async () => {
    await start();
    await claimConnectAttempt(
      callId,
      db,
      new Date(now.getTime() + 91000),
      false,
    );
    expect((await db.select().from(calls))[0]!.outcome).toMatchObject({
      reason: "worker_lost",
    });
  });
});
