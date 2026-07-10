import { getServerEnv } from "./env";
import { ApiError } from "./auth";

type PaymentRequirements = {
  x402Version: 2;
  accepts: Array<{
    scheme: "batch-settlement";
    network: "eip155:8453";
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
  }>;
};

export function paymentRequirements(maxAmountMicros: number): PaymentRequirements {
  const env = getServerEnv();
  return {
    x402Version: 2,
    accepts: [{
      scheme: "batch-settlement",
      network: "eip155:8453",
      asset: env.X402_USDC_ASSET,
      amount: String(maxAmountMicros),
      payTo: env.X402_PAY_TO,
      maxTimeoutSeconds: 3600,
    }],
  };
}

export function paymentRequiredResponse(maxAmountMicros: number) {
  const requirements = paymentRequirements(maxAmountMicros);
  return Response.json(
    { error: "payment_required", paymentRequirements: requirements },
    {
      status: 402,
      headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(requirements)).toString("base64") },
    },
  );
}

export function readPaymentPayload(request: Request) {
  const header = request.headers.get("payment-signature");
  if (!header) throw new ApiError(402, "Payment authorization is required");
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as unknown;
  } catch {
    throw new ApiError(402, "Payment authorization is malformed");
  }
}

const VERIFY_TIMEOUT_MS = 10_000;
const SETTLE_TIMEOUT_MS = 30_000;

async function callCdp(path: "verify" | "settle", body: unknown, timeoutMs: number, timeoutStatus: number) {
  try {
    return await fetch(`https://api.cdp.coinbase.com/platform/v2/x402/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getServerEnv().CDP_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(timeoutStatus, `Payment ${path} did not respond in time`);
  }
}

export async function verifyPayment(paymentPayload: unknown, requirements: PaymentRequirements) {
  const response = await callCdp("verify", { x402Version: 2, paymentPayload, paymentRequirements: requirements.accepts[0] }, VERIFY_TIMEOUT_MS, 402);
  if (!response.ok) throw new ApiError(402, "Payment authorization could not be verified");
  const verified = (await response.json()) as { isValid?: boolean; payer?: string };
  if (!verified.isValid) throw new ApiError(402, "Payment authorization is not valid");
  return verified;
}

export async function settlePayment(paymentPayload: unknown, requirements: PaymentRequirements, amountMicros: number) {
  const response = await callCdp("settle", {
    x402Version: 2,
    paymentPayload,
    paymentRequirements: { ...requirements.accepts[0], amount: String(amountMicros) },
  }, SETTLE_TIMEOUT_MS, 502);
  if (!response.ok) throw new ApiError(502, "Payment settlement could not be completed");
  return (await response.json()) as { success?: boolean; transaction?: string; payer?: string; errorReason?: string };
}
