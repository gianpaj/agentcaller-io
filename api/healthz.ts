import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HealthCheckResponse } from "../src/api-zod/generated/api.js";

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.json(HealthCheckResponse.parse({ status: "ok" }));
}
