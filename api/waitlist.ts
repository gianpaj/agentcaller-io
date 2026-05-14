import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "drizzle-orm";
import { db, waitlistTable } from "../src/db/index.js";
import { JoinWaitlistBody } from "../src/api-zod/generated/api.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "POST") {
    const parsed = JoinWaitlistBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    const { email } = parsed.data;

    try {
      const [entry] = await db
        .insert(waitlistTable)
        .values({ email })
        .onConflictDoNothing({ target: waitlistTable.email })
        .returning();

      if (!entry) {
        res
          .status(409)
          .json({ error: "This email is already on the waitlist." });
        return;
      }

      res.status(201).json({
        id: entry.id,
        email: entry.email,
        createdAt: entry.createdAt.toISOString(),
      });
    } catch (err: unknown) {
      console.error("Failed to insert waitlist entry", err);
      res
        .status(500)
        .json({ error: "Something went wrong. Please try again." });
    }
    return;
  }

  if (req.method === "GET") {
    const result = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(waitlistTable);

    res.json({ count: result[0]?.count ?? 0 });
    return;
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).json({ error: "Method not allowed" });
}
