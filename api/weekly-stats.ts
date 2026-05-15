import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sql } from "drizzle-orm";
import { db } from "../src/db/index.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const isProd = process.env.NODE_ENV === "production";

  const authHeader = req.headers["authorization"];
  if (isProd && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (!webhookUrl) {
    res.status(500).json({ error: "Missing TELEGRAM_WEBHOOK_URL" });
    return;
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    res.status(500).json({ error: "Missing TELEGRAM_CHAT_ID" });
    return;
  }

  const [[totalResult], [newThisWeekResult]] = await Promise.all([
    db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM waitlist`,
    ),
    db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM waitlist WHERE created_at >= now() - interval '7 days'`,
    ),
  ]);

  const total = Number(totalResult.count);
  const newThisWeek = Number(newThisWeekResult.count);

  const date = new Date().toISOString().slice(0, 10);
  const message =
    `📊 *agentcaller.io weekly stats* (${date})\n\n` +
    `Waitlist\n` +
    `• New this week: *${newThisWeek}*\n` +
    `• Total: *${total}*`;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
  });

  res.json({ ok: true, total, newThisWeek });
}
