import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSafeAuthRedirect } from "@/lib/auth-redirect";
import { getSupabaseEnv } from "@/lib/env";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const destination = getSafeAuthRedirect(url.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(destination, url.origin));
  const env = getSupabaseEnv();
  const supabase = createServerClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () =>
          request.headers
            .get("cookie")
            ?.split("; ")
            .map((item) => {
              const [name, ...parts] = item.split("=");
              return { name, value: parts.join("=") };
            }) ?? [],
        setAll: (values) =>
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          ),
      },
    },
  );
  if (!code)
    return NextResponse.redirect(
      new URL("/login?error=missing_code", url.origin),
    );
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error)
    return NextResponse.redirect(
      new URL("/login?error=exchange_failed", url.origin),
    );
  return response;
}
