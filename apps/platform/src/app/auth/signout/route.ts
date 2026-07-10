import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getServerEnv } from "@/lib/env";

export async function POST(request: Request) { const env = getServerEnv(); const response = NextResponse.redirect(new URL("/", request.url)); const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => [], setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } }); await supabase.auth.signOut(); return response; }
