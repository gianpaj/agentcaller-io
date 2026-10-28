import "./support/server-preload.mjs";
import { expect, test } from "vitest";
import { createDatabase } from "@agentcaller/database";
import { closeBillingPeriod } from "../src/lib/billing-invoices";
import { drainBilling } from "../src/lib/billing-drain";
import { stripeClient, stripeApiVersion } from "../src/lib/stripe";
import { fixtureStripeApiVersion } from "./support/fake-stripe.mjs";

test("run the real accounting job with an explicit billing clock", async () => {
  expect(fixtureStripeApiVersion).toBe(stripeApiVersion);
  const { db, client } = createDatabase(process.env.DATABASE_URL);
  try {
    if (process.env.E2E_BILLING_AT) {
      const now = new Date(process.env.E2E_BILLING_AT);
      expect(Number.isFinite(now.getTime())).toBe(true);
      await drainBilling(stripeClient(), db, now);
      return;
    }
    const wall = Date.now();
    const start = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    );
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
    const [owner] =
      await client`insert into client_profiles (name) values ('Clock boundary fixture') returning id`;
    const [account] =
      await client`insert into billing_accounts (client_id) values (${owner.id}) returning id`;
    const [period] =
      await client`insert into billing_periods (client_id,billing_account_id,starts_at,ends_at,limit_cents) values (${owner.id},${account.id},${start.toISOString()},${end.toISOString()},1000) returning id`;
    await closeBillingPeriod(period.id, db, new Date());
    expect(
      (
        await client`select status from billing_periods where id=${period.id}`
      )[0].status,
    ).toBe("open");
    await closeBillingPeriod(period.id, db, end);
    expect(
      (
        await client`select status,total_cents from billing_periods where id=${period.id}`
      )[0],
    ).toMatchObject({ status: "closed", total_cents: 0 });
    expect(
      (await client`select count(*)::int as n from billing_invoices`)[0].n,
    ).toBe(0);
    expect(Date.now() - wall).toBeLessThan(15_000);
  } finally {
    await client.end({ timeout: 1 });
  }
});
