import { syncBuiltinESMExports } from "node:module";
import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";

const control = process.env.E2E_CONTROL_URL;
const token = process.env.E2E_CONTROL_TOKEN;
if (!control || !token || new URL(control).hostname !== "127.0.0.1")
  throw new Error("E2E interception requires its loopback coordinator");
const allowed = new Set([control, process.env.NEXT_PUBLIC_APP_URL]);

const guard = Symbol.for("agentcaller.e2e.networkGuard");
if (!process[guard]) {
  process[guard] = true;
  const server = setupServer(
    http.all("*", async ({ request }) => {
      const url = new URL(request.url);
      if (allowed.has(url.origin)) return passthrough();
      if (url.href === "https://registry.npmjs.org/-/package/next/dist-tags")
        return HttpResponse.json({ latest: "16.3.8", canary: "16.3.8" });
      if (url.origin === "https://api.stripe.com") {
        const result = await fetch(control + "/control/stripe", {
          method: "POST",
          headers: { "content-type": "application/json", "x-e2e-token": token },
          body: JSON.stringify({
            method: request.method,
            path: url.pathname + url.search,
            headers: Object.fromEntries(request.headers),
            body: await request.text(),
          }),
        });
        return new HttpResponse(await result.text(), {
          status: result.status,
          headers: { "content-type": "application/json" },
        });
      }
      await fetch(control + "/control/violation", {
        method: "POST",
        headers: { "content-type": "application/json", "x-e2e-token": token },
        body: JSON.stringify({ origin: url.origin }),
      });
      return HttpResponse.json(
        { error: "Blocked unexpected E2E outbound origin" },
        { status: 599 },
      );
    }),
  );
  server.listen({ onUnhandledRequest: "error" });

  // Named ESM imports of node:http(s) must see the intercepted exports too.
  syncBuiltinESMExports();
}
