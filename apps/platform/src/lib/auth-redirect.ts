type AuthRedirectEnv = Record<string, string | undefined>;

const allowedAuthRedirects = new Set(["/app", "/reset-password"]);

function toOrigin(value: string) {
  const url = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`,
  );
  return url.origin;
}

export function getAuthCallbackUrl(env: AuthRedirectEnv = process.env) {
  const baseUrl =
    env.NEXT_PUBLIC_APP_URL ||
    env.NEXT_PUBLIC_VERCEL_URL ||
    env.VERCEL_URL ||
    "http://localhost:3000";

  return new URL("/auth/callback", toOrigin(baseUrl)).toString();
}

export function getPasswordRecoveryCallbackUrl(
  env: AuthRedirectEnv = process.env,
) {
  const url = new URL(getAuthCallbackUrl(env));
  url.searchParams.set("next", "/reset-password");
  return url.toString();
}

export function getSafeAuthRedirect(value: string | null) {
  return value && allowedAuthRedirects.has(value) ? value : "/app";
}
