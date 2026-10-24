import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function billingSetupToken(
  requestId: string,
  generation: number,
  expiresAt: Date,
  secret: string,
) {
  z.uuid().parse(requestId);
  z.number().int().positive().max(2_147_483_647).parse(generation);
  z.string().min(32).parse(secret);
  if (!Number.isSafeInteger(expiresAt.getTime()))
    throw new Error("Invalid setup expiry");
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "billing-setup-v1",
        requestId,
        generation,
        expiresAt.toISOString(),
      ]),
    )
    .digest("base64url");
}
export function billingSetupTokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function verifyBillingSetupToken(
  token: string,
  digest: string,
  expiresAt: Date,
  now = new Date(),
) {
  if (
    !/^[\w-]{43}$/.test(token) ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt <= now
  )
    return false;
  return timingSafeEqual(
    Buffer.from(billingSetupTokenDigest(token), "hex"),
    Buffer.from(digest, "hex"),
  );
}
