import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createIdentityFake } from "./fake-supabase.mjs";
import { createStripeFake } from "./fake-stripe.mjs";

export async function startCoordinator(appUrl) {
  const token = randomUUID();
  let origin;
  const identity = await createIdentityFake(appUrl, () => origin);
  const stripe = createStripeFake();
  let dispatches = [],
    deletedRooms = [],
    violations = [];
  let failRoomCleanup = false;
  const callbackPrompts = new Map();
  const state = () => ({
    identity: identity.snapshot(),
    stripe: stripe.snapshot(),
    dispatches,
    deletedRooms,
    violations,
    callbackPrompts: Object.fromEntries(callbackPrompts),
  });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 1048576) throw new Error("Fixture body exceeds bound");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(body.length ? { body } : {}),
      });
      let response;
      if (url.pathname.startsWith("/control/")) {
        if (request.headers.get("x-e2e-token") !== token)
          response = Response.json(
            { error: "Fixture authorization required" },
            { status: 401 },
          );
        else {
          const input = body.length ? JSON.parse(body) : {};
          if (url.pathname === "/control/state")
            response = Response.json(state());
          else if (url.pathname === "/control/reset") {
            identity.reset();
            stripe.reset();
            dispatches = [];
            deletedRooms = [];
            violations = [];
            failRoomCleanup = false;
            callbackPrompts.clear();
            response = Response.json(state());
          } else if (url.pathname === "/control/stripe")
            response = await stripe.request(input);
          else if (url.pathname === "/control/violation") {
            violations.push(input.origin);
            response = Response.json({ recorded: true });
          } else if (url.pathname === "/control/command") {
            if (
              input.target === "livekit" &&
              input.action === "cleanup-failure"
            ) {
              failRoomCleanup = input.enabled === true;
              response = Response.json({ enabled: failRoomCleanup });
            } else if (
              input.target === "livekit" &&
              ["callback-prompt-ready", "release-callback-prompt"].includes(
                input.action,
              )
            ) {
              if (typeof input.attemptId !== "string")
                throw new Error("Callback prompt requires an attempt ID");
              if (input.action === "release-callback-prompt")
                callbackPrompts.set(input.attemptId, "released");
              else if (!callbackPrompts.has(input.attemptId))
                callbackPrompts.set(input.attemptId, "held");
              response = Response.json({
                status: callbackPrompts.get(input.attemptId),
              });
            } else
              response = Response.json(
                await (input.target === "identity" ? identity : stripe).control(
                  input.action,
                  input,
                ),
              );
          }
        }
      } else if (
        url.pathname.startsWith("/auth/") ||
        url.pathname.startsWith("/.well-known/") ||
        url.pathname === "/agent/callback"
      )
        response = await identity.handle(request);
      else if (url.pathname.endsWith("/CreateDispatch")) {
        const dispatch = { id: randomUUID(), ...JSON.parse(body) };
        dispatches.push(dispatch);
        response = Response.json(dispatch);
      } else if (url.pathname.endsWith("/DeleteRoom")) {
        if (failRoomCleanup)
          response = Response.json(
            { code: "unavailable", msg: "Simulated provider cleanup failure" },
            { status: 503 },
          );
        else {
          deletedRooms.push(JSON.parse(body).room);
          response = Response.json({});
        }
      }
      if (!response)
        response = Response.json(
          { error: "Unsupported fixture request" },
          { status: 501 },
        );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "Fixture request failed" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  identity.reset();
  return {
    origin,
    token,
    state,
    stop: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
