import { createServer } from "node:http";
import { test, expect, control } from "./support/fixtures.mjs";

test("runner fetch, API requests and browser WebSockets cannot escape the allowlist", async ({
  context,
  page,
}) => {
  let received = 0;
  const outside = createServer((_request, response) => {
    received++;
    response.end("outside the fixture allowlist");
  });
  outside.on("upgrade", (_request, socket) => {
    received++;
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    outside.once("error", reject);
    outside.listen(0, "127.0.0.1", resolve);
  });
  const origin = "http://127.0.0.1:" + outside.address().port;
  try {
    const direct = await fetch(origin + "/runner-fetch");
    expect(direct.status).toBe(599);
    await direct.body?.cancel();
    const api = await context.request.get(origin + "/api-request");
    expect(api.status()).toBe(599);
    await api.dispose();

    const wsOrigin = origin.replace(/^http/, "ws");
    const outcome = await page.evaluate(
      (target) =>
        new Promise((resolve) => {
          const socket = new WebSocket(target);
          const timeout = setTimeout(() => {
            socket.close();
            resolve("timeout");
          }, 5000);
          const blocked = () => {
            clearTimeout(timeout);
            resolve("blocked");
          };
          socket.onerror = blocked;
          socket.onclose = blocked;
        }),
      wsOrigin + "/browser-websocket",
    );
    expect(outcome).toBe("blocked");
    expect(received).toBe(0);
    expect((await control("state")).violations).toEqual([
      origin,
      origin,
      wsOrigin,
    ]);
  } finally {
    outside.closeAllConnections();
    await new Promise((resolve) => outside.close(resolve));
    await control("reset", {});
  }
});
