import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getServerEnv } from "@/lib/env";

export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get("code"); const response = NextResponse.redirect(new URL("/app", url.origin)); const env = getServerEnv();
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => request.headers.get("cookie")?.split("; ").map((item) => { const [name, ...parts] = item.split("="); return { name, value: parts.join("=") }; }) ?? [], setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } });
  if (code) await supabase.auth.exchangeCodeForSession(code);
  return response;
}
