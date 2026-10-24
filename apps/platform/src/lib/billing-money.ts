import {
  centsSchema,
  legLimit,
  usdRateSchema,
  unpaidExposureLimitCents,
  type ConnectMeTask,
  type UsdRate,
} from "@agentcaller/contracts";

function microsToCents(value: bigint) {
  if (value < 0n) throw new Error("Usage cannot be negative");
  const cents = (value + 9999n) / 10000n;
  if (cents > 2_147_483_647n)
    throw new Error("Usage exceeds supported cents range");
  return Number(cents);
}

function startedMinuteMicros(rate: UsdRate, elapsedMs: bigint) {
  if (elapsedMs < 0n) throw new Error("End must not precede connection");
  const minutes = (elapsedMs + 59_999n) / 60_000n;
  return (
    BigInt(rate.connectionFeeMicros) +
    minutes * BigInt(rate.startedMinuteFeeMicros)
  );
}

export function quoteConnectCents(
  task: ConnectMeTask,
  business: UsdRate,
  callback: UsdRate,
) {
  usdRateSchema.parse(business);
  usdRateSchema.parse(callback);
  if (
    !Number.isSafeInteger(task.maxAttempts) ||
    task.maxAttempts < 1 ||
    task.maxAttempts > 6
  )
    throw new Error("Invalid attempt count");
  if (business.pricingVersion !== callback.pricingVersion)
    throw new Error("Quote requires one accepted pricing version");
  const duration = (leg: "business" | "callback") => {
    const seconds = legLimit(task, leg);
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 1800)
      throw new Error("Invalid leg duration");
    return BigInt(seconds) * 1000n;
  };
  return microsToCents(
    BigInt(task.maxAttempts) *
      (startedMinuteMicros(business, duration("business")) +
        startedMinuteMicros(callback, duration("callback"))),
  );
}

export type LegUsageEvidence =
  | { state: "unanswered"; rate: UsdRate }
  | { state: "unknown" }
  | { state: "connected"; connectedAt: Date; endedAt: Date; rate: UsdRate };

/** Requires trusted leg observations; terminal outcomes alone are not evidence. */
export function assessCallUsage(
  legs: LegUsageEvidence[],
  reservedCents: number,
  cleanupConfirmed: boolean,
) {
  centsSchema.parse(reservedCents);
  if (
    !cleanupConfirmed ||
    legs.length === 0 ||
    legs.some((leg) => leg.state === "unknown")
  )
    return { state: "metering_pending" as const };
  let micros = 0n;
  for (const leg of legs) {
    if (leg.state === "unknown") continue;
    usdRateSchema.parse(leg.rate);
    // A leg that rang without an answer pays only its connection fee.
    if (leg.state === "unanswered") {
      micros += BigInt(leg.rate.connectionFeeMicros);
      continue;
    }
    const start = leg.connectedAt.getTime(),
      end = leg.endedAt.getTime();
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      throw new Error("Invalid connected timestamps");
    micros += startedMinuteMicros(leg.rate, BigInt(end) - BigInt(start));
  }
  const measuredCents = microsToCents(micros);
  return {
    state: "finalized" as const,
    measuredMicros: micros.toString(),
    finalCents: Math.min(measuredCents, reservedCents),
    overrunCents: Math.max(0, measuredCents - reservedCents),
  };
}

export function billingHeadroom(input: {
  accountLimitCents: number;
  accountSpentCents: number;
  accountReservedCents: number;
  grantLimitCents: number;
  grantSpentCents: number;
  grantReservedCents: number;
  unpaidCents: number;
  allReservedCents: number;
}) {
  for (const value of Object.values(input)) centsSchema.parse(value);
  const account = Math.max(
    0,
    input.accountLimitCents -
      input.accountSpentCents -
      input.accountReservedCents,
  );
  const grant = Math.max(
    0,
    input.grantLimitCents - input.grantSpentCents - input.grantReservedCents,
  );
  const exposure = Math.max(
    0,
    unpaidExposureLimitCents - input.unpaidCents - input.allReservedCents,
  );
  return {
    accountCents: account,
    grantCents: grant,
    exposureCents: exposure,
    availableCents: Math.min(account, grant, exposure),
  };
}
