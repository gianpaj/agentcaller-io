import { authenticateApiPrincipal } from "./auth";
import { authenticateMcpPrincipal } from "./mcp-auth";
export function isOAuthRequest(request: Request) {
  return !/^Bearer\s+ac_/i.test(request.headers.get("authorization") ?? "");
}
export async function authenticateBillingPrincipal(request: Request) {
  return isOAuthRequest(request)
    ? authenticateMcpPrincipal(request)
    : authenticateApiPrincipal(request);
}
