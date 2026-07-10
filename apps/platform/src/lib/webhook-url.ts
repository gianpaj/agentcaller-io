import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function ipv4IsPrivate(address: string) {
  const [a, b] = address.split(".").map(Number);
  if (a === undefined || b === undefined) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function ipv6IsPrivate(address: string) {
  const value = address.toLowerCase().split("%")[0] ?? "";
  if (value === "::1" || value === "::") return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return ipv4IsPrivate(mapped[1]);
  const head = value.slice(0, 2);
  if (head === "fc" || head === "fd") return true; // unique local
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true; // link-local
  return false;
}

export function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return ipv4IsPrivate(address);
  if (family === 6) return ipv6IsPrivate(address);
  return true;
}

/**
 * Rejects webhook targets that resolve into the platform's own network. Note this validates the
 * hostname's addresses at check time; a hostile DNS server can still rebind between this lookup
 * and the fetch. Redirects are disabled at the call site so a redirect cannot be used to reach
 * an address that never appeared here.
 */
export async function assertPublicWebhookUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Webhook URL is malformed");
  }
  if (url.protocol !== "https:") throw new Error("Webhook URL must use HTTPS");
  if (url.username || url.password) throw new Error("Webhook URL must not embed credentials");

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error("Webhook URL must not target a private address");
    return url;
  }

  const addresses = await lookup(hostname, { all: true }).catch(() => {
    throw new Error("Webhook URL host could not be resolved");
  });
  if (!addresses.length) throw new Error("Webhook URL host could not be resolved");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Webhook URL must not target a private address");
  }
  return url;
}
